import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
    Alert,
    App,
    Button,
    Card,
    Descriptions,
    Segmented,
    Upload,
    Empty,
    Input,
    Result,
    Spin,
    Steps,
    Tag,
    Tooltip,
    Typography,
    theme,
} from "antd";
import dayjs from "dayjs";
import {
    DeleteOutlined,
    FilePdfOutlined,
    InboxOutlined,
    SaveOutlined,
    SendOutlined,
} from "@ant-design/icons";
import { App_PageToolbar } from "@/components/app-shell/App_PageToolbar";
import { App_SmallScreenNotice } from "@/components/app-shell/App_SmallScreenNotice";
import { useApp_Breakpoint } from "@/hooks/useApp_Breakpoint";
import {
    App_EnvelopeRecipientsEditor,
    const_Envelope_SenderRoleOrder,
    utils_Envelope_IsCcComplete,
    utils_Envelope_IsCcEmpty,
    utils_Envelope_IsRecipientComplete,
    type EnvelopeCcRecipient,
    type EnvelopeRecipient,
} from "@/components/envelopes/App_EnvelopeRecipientsEditor";
import {
    App_EnvelopeScheduleEditor,
    utils_Envelope_ScheduleNow,
    type EnvelopeSchedule,
} from "@/components/envelopes/App_EnvelopeScheduleEditor";
import {
    utils_Envelope_SignerAuthOption,
    type Envelope_SignerAuth,
} from "@/components/envelopes/const_EnvelopeSignerAuthOptions";
import { App_DocumentFiller } from "@/components/signing/App_DocumentFiller";
import { useQ_Tables_MyCapabilities } from "@/hooks/useQ_Tables_MyCapabilities";
import {
    useQ_Tables_Templates,
    type Tables_Templates_QueryData,
} from "@/hooks/useQ_Tables_Templates";
import { useQ_Tables_Template, type Tables_Template_QueryData } from "@/hooks/useQ_Tables_Template";
import { useM_Template_Create } from "@/hooks/useM_Template_Create";
import { useM_Template_Delete } from "@/hooks/useM_Template_Delete";
import { useM_Template_SaveLayout } from "@/hooks/useM_Template_SaveLayout";
import { useM_Template_UploadPdf } from "@/hooks/useM_Template_UploadPdf";
import { useQ_Template_PdfReadUrl } from "@/hooks/useQ_Template_PdfReadUrl";
import { useM_Envelope_Send } from "@/hooks/useM_Envelope_Send";
import { useM_Envelope_DraftCreate } from "@/hooks/useM_Envelope_DraftCreate";
import { useM_Envelope_DraftUpdate } from "@/hooks/useM_Envelope_DraftUpdate";
import { useQ_Tables_Envelope } from "@/hooks/useQ_Tables_Envelope";
import type { Signing_Field } from "@/hooks/useQ_Signing_Session";
import {
    utils_Templates_MigrateLayout,
    utils_Templates_MigrateSignerRoles,
    const_Templates_DefaultSignerRoles,
} from "@/components/templates/utils_Templates_MigrateLayout";
import { App_TemplateFieldWorkspace } from "@/components/templates/App_TemplateFieldWorkspace";
import { MAX_UPLOAD_SIZE_BYTES, MAX_UPLOAD_SIZE_MB } from "@/utils/const_FileUpload";
import type { SignerRole, TemplateLayout } from "@/types/template.types";
import { Utils_Scope_Route } from "@/utils/Utils_Scope_Route";
import type { OrganizationScope } from "@/providers/organization/Provider_Organization";

// Compose an envelope: pick a document, say who signs it, fill your own part,
// send.
//
// This replaces `App_OnboardingWizardModal`, and the shape of the change is the
// point. The v1 wizard asked for an EMPLOYEE EMAIL first, because there was
// exactly one recipient and they were being hired. Here the document comes
// first and the parties come from the template's roles, because a contract has
// two or more sides and none of them is the subject of the other.
//
// Three steps, matching the plan. Sender pre-fill lives inside the last one
// rather than getting its own: it is the same act as reviewing — you are looking
// at the finished document deciding whether to send it — and splitting them
// meant the v1 wizard showed the contract twice.
//
// This page still does NOT create a row on entry, the way `Page_TemplateBuilder`
// mints a template before opening — even now that drafts exist. A signature
// request's `source_pdf_sha256` is NOT NULL and is evidence, so the row cannot
// exist until a server has read the PDF and hashed it, which means it cannot exist
// before a template is chosen. So the composer holds its state locally and a row
// appears when the sender either SAVES (`envelopes_draft_create`) or SENDS
// (`envelopes_send`) — never merely by arriving.
//
// DRAFTS (Phase G). The same component serves `envelopes/new` and
// `envelopes/$envelopeId/edit`; `envelopeId` is the only difference, and it makes
// every save an UPDATE rather than an INSERT. Resuming seeds the local state from
// the row once and then behaves identically, which is why there is no second
// editor — a separate one would be a second place for every step and every
// validation rule to drift.

// STEPS ARE DERIVED, NOT A CONSTANT (CG-017). Uploading a document inserts a
// "Place fields" step that picking a template does not need — and so does
// choosing to edit a picked template's fields for one envelope, which takes a
// private copy and then follows the upload path exactly. So the step INDEX no
// longer identifies the step. Everything below therefore switches on a step ID
// and asks `steps.indexOf(...)` for the number, because an index comparison like
// `currentStep === 2` silently means a different step in the two modes.
type StepId = "document" | "fields" | "recipients" | "prepare";

const STEP_TITLES: Record<StepId, string> = {
    document: "Document",
    fields: "Place fields",
    recipients: "Recipients",
    prepare: "Prepare & send",
};

/**
 * Where the document comes from, and — as of the template-editing path — how much
 * of it this envelope owns.
 *
 *   template   — a library template, used exactly as it stands. No field step:
 *                the layout belongs to the library and editing it here would edit
 *                it for every other envelope built from the same row.
 *   upload     — a PDF picked in the composer, backed by a hidden one-off template.
 *   customized — a library template COPIED into a hidden one-off template for this
 *                envelope alone. From this point it behaves exactly like `upload`,
 *                which is the whole reason it is a mode rather than a flag: every
 *                rule about persisting a layout before sending already holds for
 *                the ad-hoc path, and a parallel set of them would be a second
 *                place for those rules to drift.
 */
type DocumentSource = "template" | "upload" | "customized";

/** The two ad-hoc modes place fields; a pristine library template does not. */
const isAdHocSource = (source: DocumentSource): boolean => source !== "template";

const stepsFor = (documentSource: DocumentSource): StepId[] =>
    isAdHocSource(documentSource)
        ? ["document", "fields", "recipients", "prepare"]
        : ["document", "recipients", "prepare"];

type FieldError = { id: string; label: string };

/**
 * What `ensureAdHocTemplate` resolved, handed straight to `persistAdHocLayout`.
 *
 * These are returned rather than read back out of component state because the two
 * run inside one async handler, where the `setState` calls that carry them have not
 * flushed yet. Reading state there yields the values from before the create.
 */
type AdHocHandle = { templateId: string; pdfFilePath: string | null };

type Props = {
    organizationId: string;
    /** Present on the edit route: resume this draft instead of starting empty. */
    envelopeId?: string;
    /** `new` route only — pre-selects the picker for a sender who arrived from a
     *  template card. A draft has already made that choice. */
    templateId?: string;
    /** CG-048. Decides where every navigation out of the composer goes, and — on a
     *  fresh composition — whether the document fork is offered at all. */
    scope?: OrganizationScope;
};

export const Page_EnvelopeComposer = ({
    organizationId,
    envelopeId,
    templateId: initialTemplateId,
    scope = "org",
}: Props) => {
    const { token } = theme.useToken();
    const { isMobile } = useApp_Breakpoint();
    const navigate = useNavigate();

    const [currentStepId, setCurrentStepId] = useState<StepId>("document");
    /** Set by `App_SmallScreenNotice`'s escape hatch — see the branch before the
     *  main return. */
    const [smallScreenOverride, setSmallScreenOverride] = useState(false);

    // CG-017 — the document may be PICKED from the library or UPLOADED here, and
    // a picked one may then be CUSTOMIZED for this envelope alone.
    /**
     * CG-048. The personal workspace has no template library, so a fresh personal
     * composition starts on the upload path and never offers the fork.
     *
     * `!envelopeId` IS LOAD-BEARING. Resuming a draft must start as `template` in
     * BOTH scopes — see the note in the hydration effect: by the time a draft
     * exists its document is a real (if unlisted) row that `useQ_Tables_Template`
     * reads by id, so `template` is what lands a resumed upload on Recipients
     * rather than back in field placement. Starting a resumed personal draft as
     * `upload` would also send `ensureAdHocTemplate` looking for a file picked in
     * an earlier session and mint a second one-off template for it.
     */
    const [documentSource, setDocumentSource] = useState<DocumentSource>(
        scope === "personal" && !envelopeId ? "upload" : "template"
    );
    /**
     * The library template a `customized` document was copied FROM.
     *
     * Kept because `templateId` stops naming it the moment the copy exists — it
     * points at the one-off row from then on. This is what lets the step say which
     * template the sender started from, and what "use the template as it is"
     * restores.
     */
    const [customizedFrom, setCustomizedFrom] = useState<{ id: string; name: string } | null>(null);
    /** Picked but not uploaded. Field placement runs against a blob URL, so nothing
     *  touches R2 or the database until something actually needs a template_id. */
    const [pendingPdfFile, setPendingPdfFile] = useState<File | null>(null);
    /** The hidden one-off template backing an uploaded document, once persisted. */
    const [adHocTemplateId, setAdHocTemplateId] = useState<string | null>(null);
    const [adHocPdfFilePath, setAdHocPdfFilePath] = useState<string | null>(null);
    /** The exact `File` already in R2, so `pendingPdfFile` can OUTLIVE its upload.
     *  It has to: the blob URL built from it is the only thing that can render the
     *  document between the upload and the save that writes `pdf_file_path` onto
     *  the row, and the signed-URL path cannot work before that write. Identity
     *  comparison, not a boolean — a PDF replaced on the Place-fields step is a new
     *  `File` and must upload again. */
    const uploadedPdfFileRef = useRef<File | null>(null);
    const [adHocLayout, setAdHocLayout] = useState<TemplateLayout>([]);
    const [adHocSignerRoles, setAdHocSignerRoles] = useState<SignerRole[]>(
        const_Templates_DefaultSignerRoles
    );
    /** What was last PERSISTED — see `isAdHocDirty`, which is a correctness guard
     *  rather than a nicety. */
    const adHocBaselineRef = useRef("");
    const [templateId, setTemplateId] = useState<string | null>(initialTemplateId ?? null);
    const [title, setTitle] = useState("");
    const [titleTouched, setTitleTouched] = useState(false);
    const [recipients, setRecipients] = useState<Record<string, EnvelopeRecipient>>({});
    const [cc, setCc] = useState<EnvelopeCcRecipient[]>([]);
    const [prefilled, setPrefilled] = useState<Record<string, unknown>>({});
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
    const [schedule, setSchedule] = useState<EnvelopeSchedule>({
        expiresAt: null,
        reminderDays: [],
    });
    /** Set once the sender edits the schedule, so a later template change stops
     *  overwriting their choice with the new template's defaults. */
    const [scheduleTouched, setScheduleTouched] = useState(false);
    /**
     * CG-031. Defaults to `email_otp` — the common case is a counterparty who
     * does not have a ContractGo account and should not need one, and a default
     * that made them sign up would put the product's biggest drop-off back in
     * front of every send. A sender who wants the stronger, account-bound
     * signature picks it deliberately, which is the right way round: the option
     * with the higher cost to the recipient is the one someone chooses on purpose.
     *
     * THIS IS THE COMPOSER'S DEFAULT, NOT THE SYSTEM'S. `resolveSignerAuth` still
     * reads an ABSENT `signer_auth` as `account`, and the column's default is
     * still `account`. Those two are not this: they answer "what did a caller who
     * said nothing mean", and for an authentication setting the answer to that
     * has to stay the stricter one. Here a sender is being shown the choice and
     * can see what is selected.
     *
     * No `signerAuthTouched` twin, and the asymmetry is deliberate: the schedule
     * has TEMPLATE DEFAULTS that a later template change would want to re-apply,
     * which is the only reason that flag exists. This has none — a template has
     * no opinion about how its recipients authenticate — so nothing can ever
     * overwrite the sender's choice and there is nothing to guard.
     */
    const [signerAuth, setSignerAuth] = useState<Envelope_SignerAuth>("email_otp");

    /**
     * [ekyc] Whether recipients must pass a government-ID check — CG-033.
     *
     * NOTE THE DELIBERATE ASYMMETRY WITH `signerAuth` ABOVE. That one splits: the
     * composer defaults to `email_otp` while the SYSTEM default is `account`,
     * because "a caller said nothing" and "a sender chose while looking at the
     * options" are different questions. This has no such split — composer default
     * `false`, column default `false`, `resolveRequireIdentityCheck` default
     * `false` — because here BOTH questions have the same right answer. An
     * identity check nobody asked for is a wall in front of a contract, so
     * "we could not tell" must resolve to not required in every direction.
     */
    const [requireIdentityCheck, setRequireIdentityCheck] = useState(false);

    /**
     * The row every save writes to. Seeded from the route on the edit path, and set
     * by the FIRST save on the new path — after which saves are updates, so a
     * sender pressing save twice does not end up with two drafts of one document.
     */
    const [draftId, setDraftId] = useState<string | null>(envelopeId ?? null);
    /**
     * Whether local state is ready to be governed by the template effects below.
     *
     * On the `new` route it is true immediately. On the edit route it stays false
     * until the row has been read and copied in — without that gate the two
     * effects would fire against a freshly-selected template and overwrite the
     * saved title and schedule with the template's defaults, silently discarding
     * the sender's own choices in the moment they reopened them.
     */
    const [hydrated, setHydrated] = useState(!envelopeId);

    const qCaps = useQ_Tables_MyCapabilities({ organizationId });
    const qTemplates = useQ_Tables_Templates({ organizationId });
    const qDraft = useQ_Tables_Envelope({ envelopeId: envelopeId ?? "" });
    const mSend = useM_Envelope_Send();
    const mTemplateCreate = useM_Template_Create();
    const mTemplateSaveLayout = useM_Template_SaveLayout({ templateId: adHocTemplateId ?? "" });
    const mTemplateUploadPdf = useM_Template_UploadPdf();
    const mTemplateDelete = useM_Template_Delete();
    const mDraftCreate = useM_Envelope_DraftCreate();
    const mDraftUpdate = useM_Envelope_DraftUpdate();

    // Resume: copy the row into local state, once.
    //
    // `titleTouched` and `scheduleTouched` are both set, because a saved title and
    // a saved deadline ARE the sender's choices — they were touched, just in an
    // earlier session. Leaving them false would hand both back to the template's
    // defaults on the next render.
    const draft = qDraft.envelope;
    useEffect(() => {
        if (hydrated || !draft) return;
        // A row that has already been sent is NOT hydrated, deliberately: leaving
        // `hydrated` false is what makes the guard below render instead of an
        // editor whose save button the server would refuse.
        if (draft.status !== "draft") return;

        setTemplateId(draft.template_id);
        // NOTE the mode is deliberately left as `template`. By the time a draft
        // exists its document is a real (if unlisted) `contract_templates` row, and
        // `useQ_Tables_Template` reads it by id without the listing filter — so
        // resuming an UPLOADED draft behaves exactly like resuming a library one,
        // and lands on Recipients rather than back in field placement. Re-opening
        // the placement editor on resume would invite edits to a layout the draft
        // has already pinned a version of.
        setTitle(draft.title);
        setTitleTouched(true);
        setPrefilled((draft.prefilled_values ?? {}) as Record<string, unknown>);
        setSchedule({
            expiresAt: draft.expires_at ? dayjs(draft.expires_at) : null,
            reminderDays: (draft.reminder_days ?? []) as number[],
        });
        setScheduleTouched(true);
        // Defaulted rather than trusted: a draft saved before CG-031 has NULL
        // here, and "we could not tell what this sender chose" must resolve to
        // the stricter option.
        setSignerAuth(draft.signer_auth ?? "account");
        // [ekyc] No defaulting decision to make: a draft saved before CG-033 has
        // NULL, and NULL means not required, which is also what the column
        // default says.
        setRequireIdentityCheck(draft.require_identity_check ?? false);

        const signers = draft.signature_request_signers ?? [];
        setRecipients(
            Object.fromEntries(
                signers
                    .filter((row) => row.recipient_type === "signer" && row.role_id)
                    .map((row) => [
                        row.role_id!,
                        {
                            role_id: row.role_id!,
                            name: row.signer_name,
                            email: row.signer_email,
                            // Restored, unlike `notify_on_send` below: this one IS
                            // stored, and a re-save that dropped it would delete
                            // identification evidence the sender had already given.
                            phone: row.signer_phone ?? "",
                            // CG-032. NULL is inherit, and a draft saved before
                            // that migration has NULL — which is exactly right,
                            // so unlike `signer_auth` above there is nothing to
                            // default here.
                            auth_method: row.auth_method ?? null,
                            // [ekyc] Same rule, same reason.
                            require_identity_check: row.require_identity_check ?? null,
                        },
                    ])
            )
        );
        setCc(
            signers
                .filter((row) => row.recipient_type === "cc")
                .map((row) => ({
                    // The row id is a stable key, unlike the `crypto.randomUUID()`
                    // a freshly-added observer gets — remounting the list on every
                    // render would drop whatever was being typed.
                    key: row.id,
                    name: row.signer_name,
                    email: row.signer_email,
                    phone: row.signer_phone ?? "",
                    // NOT restored, because it is deliberately never stored: a
                    // "copy them at send time" choice is spent the moment the mail
                    // leaves, so there is nothing to remember. It reverts to off,
                    // which is the safe direction — the observer is still copied on
                    // completion either way.
                    notify_on_send: false,
                }))
        );

        setHydrated(true);
    }, [hydrated, draft]);

    const steps = useMemo(() => stepsFor(documentSource), [documentSource]);
    const currentStep = steps.indexOf(currentStepId);

    // Read the SELECTED template as its own record rather than picking it out of
    // the list. Two reasons, and the first is load-bearing as of CG-017: the list
    // now excludes ad-hoc rows, so an uploaded document's layout, roles and
    // pdf_file_path would all come back empty — including when RESUMING a draft
    // built that way. The second is a bug this fixes in passing: the list also
    // excludes archived templates, so a draft whose template was archived
    // mid-compose used to render as though it had no template at all.
    const qTemplate = useQ_Tables_Template({ templateId: templateId ?? "" });

    // While an uploaded document is still un-persisted there is no row to read, so
    // the composer's own state stands in for one. Once `persistAdHocTemplate` has
    // run, the record and this object agree.
    const isAdHoc = isAdHocSource(documentSource);
    const template = useMemo(() => {
        if (!isAdHoc) return qTemplate.template;
        if (qTemplate.template) return qTemplate.template;
        // `adHocPdfFilePath` counts as much as the local file: between the upload
        // and the row's first read this stand-in is all the composer has, and
        // collapsing it to null here dropped `hasPdf` mid-flow.
        if (!pendingPdfFile && !adHocPdfFilePath) return null;
        return {
            id: adHocTemplateId ?? "",
            name: title,
            layout: adHocLayout as unknown as Tables_Template_QueryData["layout"],
            signer_roles: adHocSignerRoles as unknown as Tables_Template_QueryData["signer_roles"],
            // A local file is a document for the purpose of "can we proceed",
            // even though no R2 key exists yet.
            pdf_file_path: adHocPdfFilePath ?? "pending://local-upload",
            default_expiry_days: null,
            default_reminder_days: [],
        } as unknown as Tables_Template_QueryData;
    }, [
        isAdHoc,
        qTemplate.template,
        pendingPdfFile,
        adHocTemplateId,
        adHocLayout,
        adHocSignerRoles,
        adHocPdfFilePath,
        title,
    ]);

    // Object URL for a PDF picked but not yet uploaded, so "Place fields" can
    // render it immediately. Revoked on replacement — the same discipline
    // `Page_TemplateBuilder` applies to its own pending file.
    const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
    useEffect(() => {
        if (!pendingPdfFile) {
            setPdfBlobUrl(null);
            return;
        }
        const url = URL.createObjectURL(pendingPdfFile);
        setPdfBlobUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [pendingPdfFile]);

    const layout = useMemo(
        () => utils_Templates_MigrateLayout(template?.layout),
        [template?.layout]
    );
    const roles = useMemo(
        () => utils_Templates_MigrateSignerRoles(template?.signer_roles),
        [template?.signer_roles]
    );
    const roleColors = useMemo(
        () => Object.fromEntries(roles.map((role) => [role.id, role.color])),
        [roles]
    );
    const senderRoleIds = useMemo(
        () =>
            new Set(
                roles.filter((r) => r.order === const_Envelope_SenderRoleOrder).map((r) => r.id)
            ),
        [roles]
    );

    // The title defaults to the template name but stays editable: a document
    // named "NDA" is what the recipient sees in their inbox, and one sender
    // often sends the same template to a dozen counterparties.
    useEffect(() => {
        if (!hydrated) return;
        if (template && !titleTouched) setTitle(template.name);
    }, [hydrated, template, titleTouched]);

    // The template's defaults, resolved to THIS send's absolute deadline. The
    // server re-resolves the same thing from the PINNED VERSION when the sender
    // leaves the schedule alone, so these two can disagree without harm — but a
    // composer that showed no deadline while the server silently applied one
    // would be lying about what is being sent.
    //
    // `scheduleTouched` is the same guard `titleTouched` is: once the sender has
    // said what they want, changing the template must not overrule them.
    useEffect(() => {
        if (!hydrated || !template || scheduleTouched) return;
        const days = template.default_expiry_days;
        setSchedule({
            expiresAt: days ? utils_Envelope_ScheduleNow().add(days, "day") : null,
            reminderDays: (template.default_reminder_days ?? []) as number[],
        });
    }, [hydrated, template, scheduleTouched]);

    const handleScheduleChange = useCallback((patch: Partial<EnvelopeSchedule>) => {
        setScheduleTouched(true);
        setSchedule((prev) => ({ ...prev, ...patch }));
    }, []);

    const qPdfUrl = useQ_Template_PdfReadUrl({
        templateId: template?.id ?? null,
        pdfFilePathKey: template?.pdf_file_path ?? null,
    });

    // The composer's view of the document is the signer's view with the roles
    // swapped: the SENDER's fields are the editable ones and everybody else's
    // render locked. `App_DocumentFiller` already draws exactly that from an
    // `editable` flag, so nothing here needs a second renderer.
    const composerFields: Signing_Field[] = useMemo(
        () =>
            layout.map((field) => ({
                ...field,
                editable:
                    senderRoleIds.has(field.role_id) &&
                    !field.read_only &&
                    field.type !== "signature" &&
                    field.type !== "initials",
            })),
        [layout, senderRoleIds]
    );

    const senderFields = useMemo(() => composerFields.filter((f) => f.editable), [composerFields]);

    const missingSenderFields = useMemo(
        () =>
            senderFields.filter((f) => {
                const value = prefilled[f.id];
                return (
                    f.required &&
                    (value === undefined || value === null || value === "" || value === false)
                );
            }),
        [senderFields, prefilled]
    );

    const recipientRoles = useMemo(
        () => roles.filter((r) => r.order !== const_Envelope_SenderRoleOrder),
        [roles]
    );

    // An untouched CC row is ignored rather than treated as an error — the "Add
    // observer" button leaves one behind by design. A row the sender STARTED and
    // left half-finished blocks the send, because silently dropping it would
    // mean someone they meant to copy never hears about the document.
    const ccToSend = useMemo(() => cc.filter((row) => !utils_Envelope_IsCcEmpty(row)), [cc]);

    const allRecipientsComplete = useMemo(
        () =>
            recipientRoles.length > 0 &&
            recipientRoles.every((role) =>
                utils_Envelope_IsRecipientComplete(recipients[role.id])
            ) &&
            ccToSend.every(utils_Envelope_IsCcComplete),
        [recipientRoles, recipients, ccToSend]
    );

    // Switches on the step ID, not its index — in upload mode "index 2" is
    // Recipients, in template mode it is Prepare & send.
    const canProceed = useMemo(() => {
        switch (currentStepId) {
            case "document":
                // Both ad-hoc modes ask the same question — is there a PDF? — and
                // `customized` answers it with the key it inherited from the
                // template it was copied from, which is why nothing is uploaded.
                return isAdHocSource(documentSource)
                    ? (!!pendingPdfFile || !!adHocPdfFilePath) && !!title.trim()
                    : !!templateId && !!template?.pdf_file_path && !!title.trim();
            case "fields":
                // At least one field, and at least one of them assigned to somebody
                // who is not the sender. Without that second check the sender walks
                // into Recipients with no role to fill and is rejected three steps
                // later by the server's own "at least one signer" rule — better to
                // say it here, where the fix is one click away.
                return (
                    adHocLayout.length > 0 &&
                    adHocLayout.some((field) =>
                        adHocSignerRoles.some(
                            (role) =>
                                role.id === field.role_id &&
                                role.order !== const_Envelope_SenderRoleOrder
                        )
                    )
                );
            case "recipients":
                return allRecipientsComplete;
            case "prepare":
                return missingSenderFields.length === 0 && !mSend.mutation.isPending;
            default:
                return false;
        }
    }, [
        currentStepId,
        documentSource,
        pendingPdfFile,
        adHocPdfFilePath,
        adHocLayout,
        adHocSignerRoles,
        templateId,
        template?.pdf_file_path,
        title,
        allRecipientsComplete,
        missingSenderFields.length,
        mSend.mutation.isPending,
    ]);

    /**
     * Why the forward button is disabled, in the sender's words.
     *
     * A disabled primary button that explains nothing is what made every bug on this
     * screen invisible: the sender is looking at a document they just uploaded and a
     * button that will not move, with nothing on screen naming the one field that is
     * empty. Mirrors `canProceed` case for case — the two must be changed together.
     * `null` when nothing is blocking.
     */
    const blockedReason = useMemo((): string | null => {
        if (canProceed) return null;
        switch (currentStepId) {
            case "document":
                if (isAdHocSource(documentSource)) {
                    if (!pendingPdfFile && !adHocPdfFilePath) return "Upload a PDF to send";
                } else {
                    if (!templateId) return "Choose a template";
                    if (!template?.pdf_file_path) {
                        return "This template has no PDF yet — open it in the builder and add one";
                    }
                }
                if (!title.trim()) return "Add a document title";
                return null;
            case "fields":
                if (adHocLayout.length === 0) return "Place at least one field on the document";
                return "At least one field must belong to a signer, not to you";
            case "recipients":
                return "Fill in a name and email for every recipient";
            case "prepare":
                if (mSend.mutation.isPending) return null;
                return "Fill your own required fields before sending";
            default:
                return null;
        }
    }, [
        canProceed,
        currentStepId,
        documentSource,
        pendingPdfFile,
        adHocPdfFilePath,
        adHocLayout.length,
        templateId,
        template?.pdf_file_path,
        title,
        mSend.mutation.isPending,
    ]);

    const handleRecipientChange = useCallback(
        (roleId: string, patch: Partial<EnvelopeRecipient>) =>
            setRecipients((prev) => ({
                ...prev,
                [roleId]: { role_id: roleId, name: "", email: "", ...prev[roleId], ...patch },
            })),
        []
    );

    // A CC has no role to key on and no database row until the envelope is sent,
    // so the list carries its own local key. `crypto.randomUUID` rather than an
    // index: removing a row would otherwise renumber every row after it and
    // React would carry the wrong input values across.
    const handleCcAdd = useCallback(
        () =>
            setCc((prev) => [
                ...prev,
                { key: crypto.randomUUID(), name: "", email: "", notify_on_send: false },
            ]),
        []
    );

    const handleCcChange = useCallback(
        (key: string, patch: Partial<EnvelopeCcRecipient>) =>
            setCc((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row))),
        []
    );

    const handleCcRemove = useCallback(
        (key: string) => setCc((prev) => prev.filter((row) => row.key !== key)),
        []
    );

    const handleFieldChange = useCallback((fieldId: string, value: unknown) => {
        setPrefilled((prev) => ({ ...prev, [fieldId]: value }));
        setFieldErrors((prev) => {
            if (!prev[fieldId]) return prev;
            const next = { ...prev };
            delete next[fieldId];
            return next;
        });
    }, []);

    // Changing the template invalidates everything downstream of it: the roles
    // are different, so the recipients no longer map, and the field ids are
    // different, so the pre-filled values would attach to nothing.
    const handleTemplateChange = useCallback((nextTemplateId: string) => {
        setTemplateId(nextTemplateId);
        setRecipients({});
        setPrefilled({});
        setFieldErrors({});
        setTitleTouched(false);
        // CC survives a template change on purpose, unlike the signers: an
        // observer is attached to no role and no field, so nothing about them
        // stops being true when the document changes.
    }, []);

    /**
     * Whether the placed fields differ from what was last PERSISTED.
     *
     * This is a CORRECTNESS guard, not a nicety. `envelopes_send` snapshots the
     * template's LATEST VERSION, not whatever this page happens to be rendering —
     * so a field placed after the last persist would exist only in React state and
     * the document would go out with fewer fields than the sender was looking at.
     * `validateForSend` cannot catch it either: it checks role coverage and the
     * sender's own required fields, not "did they place more boxes since".
     *
     * The answer is to persist unconditionally before every draft save and send
     * (below), and to keep this as the assertion that it worked.
     */
    const adHocSnapshot = useMemo(
        () => JSON.stringify({ layout: adHocLayout, roles: adHocSignerRoles, title }),
        [adHocLayout, adHocSignerRoles, title]
    );
    const isAdHocDirty = isAdHoc && adHocSnapshot !== adHocBaselineRef.current;

    /**
     * Create the hidden one-off template for an uploaded document, and put its PDF
     * in R2. Runs when the sender leaves the Document step, NOT when they pick the
     * file — picking a file is not a commitment, and field placement works against
     * a blob URL, so nothing needs to exist server-side until then.
     *
     * THE ORDER INSIDE MATTERS. The row is created before the upload because
     * `files_r2_upload-start` resolves `organization_id` from the template row and
     * keys the object under `orgs/{org}/contract-templates/{id}/…`. Uploading first
     * would need a new resource type, a new key namespace and a new branch in
     * `useM_Files_Upload`'s org derivation; this order leaves the entire upload
     * chain untouched by the feature.
     *
     * WHY THIS IS SEPARATE FROM `persistAdHocLayout`: the upload needs the template
     * id to key its object under, so the row has to exist before the bytes move. The
     * layout save then needs BOTH results, which is why this returns them rather than
     * leaving the caller to read them back out of state.
     *
     * IT RETURNS THEM BECAUSE STATE IS NOT READABLE IN TIME. `setAdHocTemplateId` and
     * `setAdHocPdfFilePath` below do not flush before a caller that awaits this in the
     * same tick reads them — which is exactly what "Save as draft" from the Document
     * step does. This function's results are the authority for that call; state is the
     * fallback for later ones, once React has caught up. An earlier version of this
     * comment claimed the id "is always already in state by the time the layout is
     * written". It is not, and that was the bug: the layout save silently no-opped and
     * the template's only version went out with no `pdf_file_path`, which
     * `resolveTemplateAndVersion` then reported as "This template version has no
     * source PDF. Upload one in the builder."
     */
    const ensureAdHocTemplate = useCallback(async (): Promise<AdHocHandle | null> => {
        // A pristine library template needs nothing created — it IS the row. Both
        // ad-hoc modes fall through, but `customized` always finds its row already
        // made: the copy is taken the moment the sender asks to edit, because the
        // layout it starts from has to exist somewhere before it can be edited.
        //
        // `pdfFilePath` is null on this branch and is never read: `persistAdHocLayout`
        // early-returns for a non-ad-hoc source, and a library template's PDF is
        // already on its own row.
        if (!isAdHocSource(documentSource)) {
            return templateId ? { templateId, pdfFilePath: null } : null;
        }
        let id = adHocTemplateId;
        if (!id) {
            const created = await mTemplateCreate.mutation.mutateAsync({
                organization_id: organizationId,
                // Named from the filename. Ad-hoc rows are exempt from the
                // per-entity unique name index (CG-017) precisely because this name
                // is not chosen by a human and could otherwise collide with a
                // library template the sender has never seen.
                name: title.trim() || pendingPdfFile?.name || "Uploaded document",
                layout: [],
                signer_roles: adHocSignerRoles,
                is_ad_hoc: true,
            });
            id = created.id;
            setAdHocTemplateId(id);
        }

        // `pendingPdfFile` is deliberately NOT cleared here.
        //
        // It used to be, and that is what left "Place fields" showing "Loading
        // PDF…" forever. Clearing it revoked the blob URL, and nothing could
        // replace it: `useM_Template_UploadPdf` does not write `pdf_file_path`
        // (the caller folds the key into its own save), so the row still had a
        // NULL path, `useQ_Template_PdfReadUrl` stayed disabled on
        // `!!pdfFilePathKey`, and the sender was asked to place fields on a
        // document that could not be drawn. The file survives until
        // `persistAdHocLayout` writes the path; the ref is what keeps it from
        // being uploaded twice.
        //
        // The key is held in a local as well as in state, and returned. `uploadedPdfFileRef`
        // is set synchronously here, so a `persistAdHocLayout` running in this same tick
        // sees its own upload guard already satisfied and would otherwise fall back to a
        // state value that has not flushed — writing `pdf_file_path: null` over a file
        // that is sitting in storage.
        let pdfFilePath = adHocPdfFilePath;
        if (pendingPdfFile && pendingPdfFile !== uploadedPdfFileRef.current) {
            const uploaded = await mTemplateUploadPdf.mutation.mutateAsync({
                templateId: id,
                file: pendingPdfFile,
            });
            uploadedPdfFileRef.current = pendingPdfFile;
            pdfFilePath = uploaded.r2_key;
            setAdHocPdfFilePath(pdfFilePath);
        }

        setTemplateId(id);
        return { templateId: id, pdfFilePath };
    }, [
        documentSource,
        templateId,
        organizationId,
        adHocTemplateId,
        adHocSignerRoles,
        pendingPdfFile,
        title,
        mTemplateCreate.mutation,
        mTemplateUploadPdf.mutation,
    ]);

    /**
     * Write the placed fields to the one-off template. ONE update, therefore ONE
     * version row — layout, roles and the PDF path travel together so the version
     * that gets pinned is the one that was on screen.
     *
     * Called before every draft save and every send, unconditionally. Cheap when
     * nothing changed: the versioning trigger dedups on `content_hash`, so an
     * unchanged layout mints no new version.
     *
     * It leaves a two-version artefact behind by design — v1 is the empty row from
     * `ensureAdHocTemplate`, v2 is the real one. `resolveTemplateAndVersion` always
     * takes the highest `version_number`, so v1 is never pinned; anything that ever
     * selected "version 1" instead would pin a PDF-less version and 409.
     *
     * PASS `fresh` WHENEVER `ensureAdHocTemplate` WAS AWAITED IN THIS SAME TICK. That
     * is what makes the call safe rather than the state fallback below — see that
     * function's header. Callers separated from it by a user action (the Place-fields
     * step) can omit it: React has flushed by then and state is correct.
     */
    const persistAdHocLayout = useCallback(
        async (fresh?: AdHocHandle) => {
            const targetId = fresh?.templateId ?? adHocTemplateId;
            if (!isAdHocSource(documentSource) || !targetId) return;

            // Replace-PDF on the Place-fields step swaps `pendingPdfFile` for a file
            // that has never been near R2 — the only other upload runs when leaving
            // the Document step, which is behind us by then. Uploading here, and
            // folding the key into the SAME save below, is what keeps the row's
            // `pdf_file_path` naming the file the fields were actually placed on.
            // Without it the sender places fields on one document and sends another.
            let pdfFilePath = fresh?.pdfFilePath ?? adHocPdfFilePath;
            if (pendingPdfFile && pendingPdfFile !== uploadedPdfFileRef.current) {
                const uploaded = await mTemplateUploadPdf.mutation.mutateAsync({
                    templateId: targetId,
                    file: pendingPdfFile,
                });
                uploadedPdfFileRef.current = pendingPdfFile;
                pdfFilePath = uploaded.r2_key;
                setAdHocPdfFilePath(pdfFilePath);
            }

            await mTemplateSaveLayout.mutation.mutateAsync({
                // The hook is bound to `adHocTemplateId`, which is stale on the first save.
                // This is the id that was actually created.
                template_id: targetId,
                name: title.trim() || "Uploaded document",
                layout: adHocLayout,
                signer_roles: adHocSignerRoles,
                pdf_file_path: pdfFilePath,
                default_expiry_days: null,
                default_reminder_days: [],
            });
            adHocBaselineRef.current = adHocSnapshot;
        },
        [
            documentSource,
            adHocTemplateId,
            adHocLayout,
            adHocSignerRoles,
            adHocPdfFilePath,
            adHocSnapshot,
            title,
            pendingPdfFile,
            mTemplateUploadPdf.mutation,
            mTemplateSaveLayout.mutation,
        ]
    );

    /**
     * Discard a one-off template the sender walked away from.
     *
     * Only on EXPLICIT abandonment, and only while no draft references it — the FK
     * is ON DELETE SET NULL, so deleting a referenced row succeeds silently and
     * quietly severs a real envelope's link to what it was made from.
     *
     * Deliberately NOT called on unmount: StrictMode double-mounts, and
     * `handleSaveDraft` navigates to the edit route, which would unmount this
     * component and delete the template the draft had just pinned.
     */
    const discardAdHocTemplate = useCallback(() => {
        if (!adHocTemplateId || draftId) return;
        mTemplateDelete.mutation.mutate({ templateId: adHocTemplateId });
        setAdHocTemplateId(null);
        setAdHocPdfFilePath(null);
    }, [adHocTemplateId, draftId, mTemplateDelete.mutation]);

    /**
     * Take a private copy of the selected template and open the field editor on it.
     *
     * THE LIBRARY ROW IS NEVER TOUCHED. Editing it in place would rewrite the
     * layout for every envelope anyone ever builds from it — including ones
     * already in flight, whose `template_snapshot` is pinned but whose senders
     * would find the library disagreeing with what went out. So this creates the
     * same kind of hidden one-off row an upload creates, seeded with this
     * template's layout and roles, and everything downstream treats it as an
     * upload from here on.
     *
     * THE PDF IS NOT COPIED, only its key. `files_r2_sign-read-url` signs whatever
     * `pdf_file_path` the template row names — it never trusts a key from the
     * client — so pointing the copy at the original object is enough to render and
     * to send, and it avoids pulling a document through the browser to put it back
     * in the same bucket. Nothing deletes it out from under the copy either:
     * `useM_Template_Delete` removes a row, never an object. Replacing the PDF on
     * the fields step still uploads under the copy's own id, as it always did.
     *
     * ROLES AND FIELD IDS ARE CARRIED OVER UNCHANGED, which is why the recipients
     * and the sender's pre-filled values survive this: they are keyed by role id
     * and field id, and a copy that renumbered either would silently strand both.
     */
    const handleCustomizeTemplate = useCallback(async () => {
        if (documentSource !== "template") return;
        if (!template?.id || !template.pdf_file_path) return;

        try {
            const created = await mTemplateCreate.mutation.mutateAsync({
                organization_id: organizationId,
                // Ad-hoc rows are exempt from the per-entity unique name index
                // (CG-017), which is what makes copying a name safe — two envelopes
                // customizing the same template do not collide.
                name: title.trim() || template.name,
                layout,
                signer_roles: roles,
                pdf_file_path: template.pdf_file_path,
                is_ad_hoc: true,
            });

            // FREEZE THE SCHEDULE the template's defaults already produced. The
            // copy carries no defaults of its own, so leaving this false would let
            // the schedule effect re-run against the stand-in and quietly clear a
            // deadline the sender was shown — the same reasoning that sets it when
            // a draft is resumed. The envelope sends its dates explicitly either
            // way, so the copy having none of its own costs nothing.
            setScheduleTouched(true);
            setCustomizedFrom({ id: template.id, name: template.name });
            setAdHocTemplateId(created.id);
            setAdHocPdfFilePath(template.pdf_file_path);
            setAdHocLayout(layout);
            setAdHocSignerRoles(roles);
            // The copy is the document now. Everything that reads `templateId` —
            // the draft payload, the send, the PDF URL — has to name the row whose
            // layout the sender is about to change.
            setTemplateId(created.id);
            setDocumentSource("customized");
            // The baseline is what was just written, so the "not saved yet" hint
            // stays quiet until the sender actually moves something.
            adHocBaselineRef.current = JSON.stringify({ layout, roles, title });
            setCurrentStepId("fields");
        } catch {
            // `useM_Template_Create` has already said what went wrong. Staying on
            // the Document step leaves the template selected and nothing lost.
        }
    }, [documentSource, template, organizationId, layout, roles, title, mTemplateCreate.mutation]);

    /**
     * Abandon the copy and go back to the template as the library holds it.
     *
     * `discardAdHocTemplate` no-ops once a draft references the copy, which is
     * correct and deliberate: the FK is ON DELETE SET NULL, so deleting a row a
     * draft points at would sever the link silently. The draft simply re-pins the
     * library template on its next save and the orphan copy is left alone.
     */
    const handleStopCustomizing = useCallback(() => {
        if (documentSource !== "customized" || !customizedFrom) return;
        discardAdHocTemplate();
        setDocumentSource("template");
        setTemplateId(customizedFrom.id);
        setCustomizedFrom(null);
        setAdHocLayout([]);
        setAdHocSignerRoles(const_Templates_DefaultSignerRoles);
        setAdHocPdfFilePath(null);
        adHocBaselineRef.current = "";
        setCurrentStepId("document");
        // Recipients and pre-filled values are NOT cleared: the copy carried the
        // template's own role ids and field ids, so everything the sender typed
        // still points at something that exists in the original.
    }, [documentSource, customizedFrom, discardAdHocTemplate]);

    /** Switching the fork throws away whatever the other mode had chosen — the two
     *  cannot both be the document, and a stale selection is how a sender ends up
     *  sending the wrong one. */
    const handleDocumentSourceChange = useCallback(
        (next: "template" | "upload") => {
            // Leaving a customization for "Use a template" is a revert, not a mode
            // switch: it must hand back the template the copy was made from rather
            // than clearing the selection and asking the sender to find it again.
            if (next === "template" && documentSource === "customized") {
                handleStopCustomizing();
                return;
            }
            if (next === documentSource) return;
            if (next === "template") discardAdHocTemplate();
            setDocumentSource(next);
            setCustomizedFrom(null);
            setTemplateId(null);
            setPendingPdfFile(null);
            uploadedPdfFileRef.current = null;
            setAdHocLayout([]);
            setAdHocSignerRoles(const_Templates_DefaultSignerRoles);
            setRecipients({});
            setPrefilled({});
            setFieldErrors({});
            setCurrentStepId("document");
        },
        [documentSource, discardAdHocTemplate, handleStopCustomizing]
    );

    const handleRemoveUpload = useCallback(() => {
        discardAdHocTemplate();
        setPendingPdfFile(null);
        uploadedPdfFileRef.current = null;
        setTemplateId(null);
        setAdHocLayout([]);
    }, [discardAdHocTemplate]);

    /** Next. In upload mode, leaving the Document step is the point at which the
     *  one-off template has to become real, because every later step needs an id. */
    const handleNext = useCallback(async () => {
        const index = steps.indexOf(currentStepId);
        const nextId = steps[index + 1];
        if (!nextId) return;
        if (currentStepId === "document" && isAdHocSource(documentSource)) {
            const resolved = await ensureAdHocTemplate();
            if (!resolved) return;
        }
        // No argument needed: this call is a whole user action away from the
        // `ensureAdHocTemplate` above, so state has flushed and the fallback inside
        // is correct. The save/send handlers, which await both in one tick, must pass
        // the handle.
        if (currentStepId === "fields") await persistAdHocLayout();
        setCurrentStepId(nextId);
    }, [steps, currentStepId, documentSource, ensureAdHocTemplate, persistAdHocLayout]);

    const handleBack = useCallback(() => {
        const index = steps.indexOf(currentStepId);
        const previousId = steps[index - 1];
        if (previousId) setCurrentStepId(previousId);
    }, [steps, currentStepId]);

    /**
     * The composition, in the shape all three write paths take.
     *
     * ONE builder for save and send, deliberately. The two calls differ only in
     * how strictly the server checks the result, and building the payload twice is
     * how a draft comes to be saved with a different set of recipients than the
     * ones the sender is looking at.
     *
     * Recipients are read defensively (`?.` and `?? ''`) because this also runs
     * while the composition is INCOMPLETE — that is what a draft is. `handleSend`
     * is still gated on `allRecipientsComplete`, and the server re-checks both ways
     * regardless.
     */
    const buildPayload = useCallback(
        // `overrideTemplateId` exists for the upload path: `ensureAdHocTemplate`
        // creates the row and RETURNS its id in the same tick that calls this, so
        // the `setTemplateId` it fired has not flushed yet — reading state here
        // would send a null template_id on the very first save of an upload.
        (overrideTemplateId?: string) => ({
            organization_id: organizationId,
            template_id: (overrideTemplateId ?? templateId)!,
            title: title.trim(),
            recipients: [
                ...recipientRoles.map((role) => ({
                    recipient_type: "signer" as const,
                    role_id: role.id,
                    name: recipients[role.id]?.name.trim() ?? "",
                    email: recipients[role.id]?.email.trim() ?? "",
                    // Sent even when blank, so CLEARING a number is a change the
                    // draft records rather than a key the server never sees.
                    phone: recipients[role.id]?.phone?.trim() ?? "",
                    // Explicit `null` for "inherit", never omitted — same
                    // argument as `expires_at` and `phone`: a key the server
                    // never sees is a key whose meaning depends on which end
                    // resolved the default, and CLEARING an exception must be a
                    // change the draft records.
                    auth_method: recipients[role.id]?.auth_method ?? null,
                    // [ekyc] Explicit null for "inherit", same argument.
                    require_identity_check: recipients[role.id]?.require_identity_check ?? null,
                })),
                // No `role_id` at all, not a null one: the CG-011 shape CHECK
                // forbids a cc row from owning a role, and a cc that owned one
                // would also own positioned field boxes it can never fill.
                ...ccToSend.map((observer) => ({
                    recipient_type: "cc" as const,
                    name: observer.name.trim(),
                    email: observer.email.trim(),
                    phone: observer.phone?.trim() ?? "",
                    notify_on_send: observer.notify_on_send,
                })),
            ],
            prefilled_values: prefilled,
            // Explicit `null` rather than omitted: the server reads `undefined` as
            // "use the pinned version's default", so leaving the key out would
            // re-apply a default the sender just switched off.
            expires_at: schedule.expiresAt ? schedule.expiresAt.toISOString() : null,
            reminder_days: schedule.reminderDays,
            // Always sent, never omitted — the server reads a missing key as
            // "account", and relying on that would make the body's meaning
            // depend on which end resolved the default.
            signer_auth: signerAuth,
            // [ekyc] Always sent, never omitted — same reason as `signer_auth`
            // above: the body's meaning must not depend on which end resolved
            // the default.
            require_identity_check: requireIdentityCheck,
        }),
        [
            organizationId,
            templateId,
            title,
            recipientRoles,
            recipients,
            ccToSend,
            prefilled,
            schedule,
            signerAuth,
            requireIdentityCheck, // [ekyc]
        ]
    );

    /**
     * Save without sending.
     *
     * The first save CREATES and then rewrites the URL to the edit route, so a
     * reload — or a closed laptop — resumes the draft instead of losing it. Every
     * save after that UPDATES the same row: without holding the returned id, a
     * sender pressing save twice would leave two drafts of one document and no way
     * to tell which was current.
     *
     * `replace: true` because the draft's edit URL is the same *place* the sender
     * already is, not a step forward — pushing it would make Back walk into the
     * empty composer they started from.
     */
    const handleSaveDraft = useCallback(async () => {
        try {
            // The one-off template has to exist and carry the CURRENT fields
            // before the draft can pin it. Both are no-ops in template mode and
            // after the first run. `resolved` is threaded into the layout save
            // rather than left to state, which has not flushed inside this tick —
            // that is what stops the first save writing a version with no PDF.
            const resolved = await ensureAdHocTemplate();
            if (!resolved) return;
            await persistAdHocLayout(resolved);
            if (draftId) {
                await mDraftUpdate.mutation.mutateAsync({
                    ...buildPayload(resolved.templateId),
                    envelope_id: draftId,
                });
                return;
            }
            const result = await mDraftCreate.mutation.mutateAsync(
                buildPayload(resolved.templateId)
            );
            setDraftId(result.id);
            navigate({
                ...Utils_Scope_Route.envelopeEdit(scope, organizationId, result.id),
                replace: true,
            });
        } catch {
            // Both hooks surface the server's own sentence. Staying put keeps
            // everything the sender has typed, which is the whole point.
        }
    }, [
        ensureAdHocTemplate,
        persistAdHocLayout,
        draftId,
        buildPayload,
        mDraftCreate.mutation,
        mDraftUpdate.mutation,
        navigate,
        scope,
        organizationId,
    ]);

    const handleSend = useCallback(async () => {
        setFieldErrors({});
        try {
            // UNCONDITIONALLY, before the send. `envelopes_send` snapshots the
            // template's latest PERSISTED version, so a field placed since the last
            // save exists only in React state — and the document would go out with
            // fewer fields than the sender is looking at. `validateForSend` does not
            // catch that, so this is the only thing standing between the two — and
            // it only stands there if the layout save actually runs, which is why
            // `resolved` is threaded in rather than read back out of state.
            const resolved = await ensureAdHocTemplate();
            if (!resolved) return;
            await persistAdHocLayout(resolved);
            const result = await mSend.mutation.mutateAsync({
                ...buildPayload(resolved.templateId),
                // Promote the draft rather than creating a second envelope. The
                // rest of the payload still travels and is still authoritative —
                // the server takes the content from here and the draft row only for
                // its identity, so what goes out is what is on screen rather than
                // whatever the last save happened to catch.
                envelope_id: draftId ?? undefined,
            });
            // The envelope's own page, which exists as of Phase I. Landing back
            // on the template library used to be the only option and left the
            // sender with no way to see the thing they had just sent.
            navigate(Utils_Scope_Route.envelopeDetail(scope, organizationId, result.id));
        } catch (err) {
            // `envelopes_send` re-validates against the PINNED VERSION, which can
            // differ from the layout this page rendered if a colleague saved the
            // builder mid-compose. When it names the fields, highlight them.
            const missing = (err as Error & { missing_fields?: FieldError[] }).missing_fields;
            if (Array.isArray(missing)) {
                setFieldErrors(
                    Object.fromEntries(missing.map((f) => [f.id, "Required before sending."]))
                );
                // The Prepare step BY NAME. Its index differs between the two
                // modes, so a numeric jump would land on Recipients for uploads.
                setCurrentStepId("prepare");
            }
        }
    }, [
        draftId,
        organizationId,
        buildPayload,
        ensureAdHocTemplate,
        persistAdHocLayout,
        mSend.mutation,
        navigate,
        scope,
    ]);

    // Waiting on the row the URL names. Rendering the empty composer meanwhile
    // would flash a blank "Document" step over a draft that has a template and a
    // title, and the sender would reasonably start filling it in again.
    if (envelopeId && !hydrated) {
        if (qDraft.query.isError || (qDraft.query.isSuccess && !draft)) {
            return (
                <Result
                    status="404"
                    title="Draft not found"
                    subTitle="It may have been deleted, or it belongs to another organization."
                    extra={
                        <Button
                            type="primary"
                            onClick={() =>
                                navigate({
                                    ...Utils_Scope_Route.envelopes(scope, organizationId),
                                    search: { status: "draft" },
                                })
                            }
                        >
                            Back to drafts
                        </Button>
                    }
                />
            );
        }

        // A row that is no longer a draft must not open in an editor. Its
        // recipients already hold links to the snapshot they were shown, and
        // `envelopes_draft_update` refuses it anyway (409) — so the honest move is
        // to send the sender to the document rather than to a form whose save
        // button cannot work.
        if (draft && draft.status !== "draft") {
            return (
                <Result
                    status="info"
                    title="This document has already been sent"
                    subTitle="A sent document cannot be edited — its recipients already have it. Void it and compose a new one if it needs to change."
                    extra={
                        <Button
                            type="primary"
                            onClick={() =>
                                navigate(
                                    Utils_Scope_Route.envelopeDetail(
                                        scope,
                                        organizationId,
                                        envelopeId
                                    )
                                )
                            }
                        >
                            Open the document
                        </Button>
                    }
                />
            );
        }

        return (
            <div style={{ display: "flex", justifyContent: "center", padding: token.paddingXL }}>
                <Spin size="large" />
            </div>
        );
    }

    const isSavingDraft = mDraftCreate.mutation.isPending || mDraftUpdate.mutation.isPending;

    // CG-027. The composer exists to write: every step of it creates a draft, a
    // one-off template or a signature request, and all three are `send_documents`
    // writes. There is nothing here to show somebody who cannot perform them, so
    // the page refuses as a whole rather than disabling its way down to an empty
    // wizard. `query.isSuccess` guards the check because the flag reads false
    // while loading and a flash of "you can't do this" is worse than a spinner.
    if (!qCaps.canSendDocuments && qCaps.query.isSuccess) {
        return (
            <Result
                status="403"
                title="You can't send documents"
                subTitle="Your account can view this organization's documents but not send new ones. An admin or the owner can grant you permission from the People page."
                extra={
                    <Button
                        type="primary"
                        onClick={() =>
                            navigate({
                                ...Utils_Scope_Route.envelopes(scope, organizationId),
                                search: { status: "all" },
                            })
                        }
                    >
                        Back to documents
                    </Button>
                }
            />
        );
    }

    // Composing is a wide job — a 300px summary rail beside a step body that at
    // one point embeds the field workspace and its four rails. Placed AFTER the
    // draft-hydration branches above so a sender who followed a link to a sent or
    // missing draft is still told which of those it was, rather than being shown a
    // "use a bigger screen" notice about an editor that was never going to open.
    if (isMobile && !smallScreenOverride) {
        return (
            <App_SmallScreenNotice
                title="Composing needs a wider screen"
                description="Choosing a template, placing fields on it and ordering recipients all want to be visible at once. Open this on a tablet or a computer to send a document. Reviewing what you have sent — and signing — work fine on a phone."
                onViewAnyway={() => setSmallScreenOverride(true)}
            />
        );
    }

    return (
        <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
            <App_PageToolbar
                actions={
                    <>
                        {/* The upload path's fields live in React state until a save
                            or a send persists them, and `envelopes_send` snapshots
                            what was PERSISTED. Saying so is cheap; discovering it
                            from a document that went out missing fields is not.
                            Both write paths persist first, so this is an indicator
                            rather than a gate. */}
                        {isAdHocDirty && adHocLayout.length > 0 && (
                            <Typography.Text
                                type="secondary"
                                style={{ fontSize: token.fontSizeSM, marginRight: token.marginXS }}
                            >
                                Field changes not saved yet
                            </Typography.Text>
                        )}
                        {/* Available from the first step onward. In template mode it
                            is gated on a template being chosen; in upload mode on a
                            file being picked, because `ensureAdHocTemplate` turns
                            that into a real template id before the draft is written.
                            That is the one thing a draft cannot exist without, since
                            `source_pdf_sha256` is NOT NULL and the server has to hash
                            something. Everything else may be half-finished; that is
                            what a draft is. */}
                        <Button
                            icon={<SaveOutlined />}
                            disabled={
                                isAdHocSource(documentSource)
                                    ? !pendingPdfFile && !adHocPdfFilePath
                                    : !templateId
                            }
                            loading={isSavingDraft}
                            onClick={handleSaveDraft}
                        >
                            {draftId ? "Save draft" : "Save as draft"}
                        </Button>
                        <Button
                            onClick={() => {
                                // Discard the one-off template the sender is walking
                                // away from. No-ops once a draft references it — the
                                // FK is ON DELETE SET NULL, so deleting a referenced
                                // row would silently sever a real envelope.
                                discardAdHocTemplate();
                                navigate({
                                    // Back to the list rather than to the template
                                    // library: a sender who just saved a draft is
                                    // looking for the draft, and Cancel that leaves
                                    // them somewhere else reads as having discarded it.
                                    ...Utils_Scope_Route.envelopes(scope, organizationId),
                                    search: { status: draftId ? "draft" : "all" },
                                });
                            }}
                        >
                            Cancel
                        </Button>
                    </>
                }
            />

            <div style={{ padding: `${token.paddingMD}px ${token.paddingMD}px 0`, flexShrink: 0 }}>
                <Steps
                    current={currentStep}
                    items={steps.map((id) => ({ title: STEP_TITLES[id] }))}
                    size="small"
                />
            </div>

            <div
                style={{
                    flex: 1,
                    minHeight: 0,
                    // The Prepare step owns its own scrolling (it embeds a PDF),
                    // and so does Place fields. By NAME, because the index of
                    // 'prepare' differs between the two modes.
                    overflow:
                        currentStepId === "prepare" || currentStepId === "fields"
                            ? "hidden"
                            : "auto",
                    padding: token.paddingMD,
                    display: "flex",
                    flexDirection: "column",
                }}
            >
                {currentStepId === "document" && (
                    <StepDocument
                        scope={scope}
                        documentSource={documentSource}
                        onDocumentSourceChange={handleDocumentSourceChange}
                        templates={qTemplates.templates}
                        isLoading={qTemplates.query.isLoading}
                        selectedTemplateId={templateId}
                        onSelect={handleTemplateChange}
                        pendingPdfFile={pendingPdfFile}
                        uploadedPdfPath={adHocPdfFilePath}
                        onPickPdf={setPendingPdfFile}
                        onRemovePdf={handleRemoveUpload}
                        title={title}
                        onTitleChange={(value) => {
                            setTitleTouched(true);
                            setTitle(value);
                        }}
                        titleMissing={titleTouched && !title.trim()}
                        onTitleBlur={() => setTitleTouched(true)}
                        hasPdf={!!template?.pdf_file_path}
                        customizedFrom={customizedFrom}
                        onCustomize={handleCustomizeTemplate}
                        onStopCustomizing={handleStopCustomizing}
                        isCustomizing={mTemplateCreate.mutation.isPending}
                        fieldCount={layout.length}
                    />
                )}

                {/* Upload mode only. The same workspace the template builder uses —
                    one canvas, one interaction model, one place a placement bug gets
                    fixed. */}
                {currentStepId === "fields" && (
                    <App_TemplateFieldWorkspace
                        pdfFileUrl={pdfBlobUrl ?? qPdfUrl.url ?? null}
                        hasPdf={!!pendingPdfFile || !!adHocPdfFilePath}
                        layout={adHocLayout}
                        onLayoutChange={setAdHocLayout}
                        signerRoles={adHocSignerRoles}
                        onSignerRolesChange={setAdHocSignerRoles}
                        onPendingPdfFileChange={setPendingPdfFile}
                    />
                )}

                {currentStepId === "recipients" && (
                    <App_EnvelopeRecipientsEditor
                        roles={roles}
                        layout={layout}
                        value={recipients}
                        onChange={handleRecipientChange}
                        cc={cc}
                        onCcAdd={handleCcAdd}
                        onCcChange={handleCcChange}
                        onCcRemove={handleCcRemove}
                        inheritedAuth={signerAuth}
                        onInheritedAuthChange={setSignerAuth}
                        inheritedIdentityCheck={requireIdentityCheck} // [ekyc]
                        onInheritedIdentityCheckChange={setRequireIdentityCheck} // [ekyc]
                    />
                )}

                {currentStepId === "prepare" && (
                    <StepPrepare
                        title={title}
                        templateName={template?.name ?? ""}
                        recipients={recipientRoles.map((role) => ({
                            role,
                            recipient: recipients[role.id],
                        }))}
                        cc={ccToSend}
                        fields={composerFields}
                        senderFieldCount={senderFields.length}
                        fieldValues={prefilled}
                        onFieldChange={handleFieldChange}
                        errors={fieldErrors}
                        roleColors={roleColors}
                        pdfUrl={qPdfUrl.url ?? null}
                        pdfLoading={qPdfUrl.query.isLoading}
                        schedule={schedule}
                        onScheduleChange={handleScheduleChange}
                    />
                )}
            </div>

            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: token.paddingMD,
                    borderTop: `1px solid ${token.colorBorder}`,
                    flexShrink: 0,
                }}
            >
                <Button disabled={currentStep === 0} onClick={handleBack}>
                    Back
                </Button>
                {/* The span is not decorative: antd renders a disabled button with
                    `pointer-events: none`, so a Tooltip wrapping it directly never
                    fires — and the reason the button is disabled is exactly what the
                    sender cannot otherwise find out. */}
                <Tooltip title={blockedReason ?? ""}>
                    <span>
                        {currentStep < steps.length - 1 ? (
                            <Button type="primary" disabled={!canProceed} onClick={handleNext}>
                                Next
                            </Button>
                        ) : (
                            <Button
                                type="primary"
                                icon={<SendOutlined />}
                                disabled={!canProceed}
                                loading={mSend.mutation.isPending}
                                onClick={handleSend}
                            >
                                Send for signature
                            </Button>
                        )}
                    </span>
                </Tooltip>
            </div>
        </div>
    );
};

// ============================================================
// Step 1 — which document
// ============================================================

type StepDocumentProps = {
    /** CG-048. `'personal'` hides the fork — upload is the only document source. */
    scope: OrganizationScope;
    documentSource: DocumentSource;
    onDocumentSourceChange: (next: "template" | "upload") => void;
    templates: Tables_Templates_QueryData;
    isLoading: boolean;
    selectedTemplateId: string | null;
    onSelect: (templateId: string) => void;
    pendingPdfFile: File | null;
    uploadedPdfPath: string | null;
    onPickPdf: (file: File | null) => void;
    onRemovePdf: () => void;
    title: string;
    onTitleChange: (value: string) => void;
    /** The title is required and empty, and the sender has already been near it. */
    titleMissing: boolean;
    onTitleBlur: () => void;
    hasPdf: boolean;
    /** Non-null while this envelope holds its own copy of a library template. */
    customizedFrom: { id: string; name: string } | null;
    onCustomize: () => void;
    onStopCustomizing: () => void;
    isCustomizing: boolean;
    /** How many boxes the chosen document carries, to say what "as it is" means. */
    fieldCount: number;
};

/**
 * Step 1 — WHICH document.
 *
 * Two ways in (CG-017): an existing template, or a PDF uploaded right here. The
 * fork is a `Segmented` rather than two cards because it is a mode switch, not a
 * choice being made once — the sender can flip back and forth while deciding, and
 * `handleDocumentSourceChange` throws away the other mode's selection each time so
 * the two can never both look chosen.
 *
 * The "no templates yet" empty state lives INSIDE the template branch. It used to
 * be an early return covering the whole step, which meant an organization with an
 * empty library could never reach the upload path — exactly the organization that
 * needs it most.
 */
const StepDocument = ({
    scope,
    documentSource,
    onDocumentSourceChange,
    templates,
    isLoading,
    selectedTemplateId,
    onSelect,
    pendingPdfFile,
    uploadedPdfPath,
    onPickPdf,
    onRemovePdf,
    title,
    onTitleChange,
    titleMissing,
    onTitleBlur,
    hasPdf,
    customizedFrom,
    onCustomize,
    onStopCustomizing,
    isCustomizing,
    fieldCount,
}: StepDocumentProps) => {
    const { token } = theme.useToken();
    const { message } = App.useApp();

    const handleBeforeUpload = (file: File) => {
        if (file.type !== "application/pdf") {
            message.error("Choose a PDF file");
            return false;
        }
        if (file.size > MAX_UPLOAD_SIZE_BYTES) {
            message.error(`PDF exceeds the ${MAX_UPLOAD_SIZE_MB}MB limit`);
            return false;
        }
        onPickPdf(file);
        // `false` — the upload runs later, inside `ensureAdHocTemplate`, because
        // the R2 key is scoped to a template row that does not exist yet.
        return false;
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: token.marginMD }}>
            {/* `customized` reads as "template" here on purpose: it IS a template,
                the sender is just carrying their own copy of it. Giving it a third
                segment would offer a mode nobody can select — the only way in is
                the button below, on a template already chosen. Clicking back to
                "Use a template" reverts the copy. */}
            {/* CG-048. HIDDEN, not disabled, in the personal workspace. A disabled
                fork advertises a library this surface deliberately does not have —
                the word "template" never appears under `/me`. With no second
                segment to switch to, the control has nothing left to say. */}
            {scope !== "personal" && (
                <Segmented
                    value={documentSource === "upload" ? "upload" : "template"}
                    onChange={(value) => onDocumentSourceChange(value as "template" | "upload")}
                    options={[
                        { label: "Use a template", value: "template" },
                        { label: "Upload a document", value: "upload" },
                    ]}
                />
            )}

            {documentSource === "customized" && customizedFrom ? (
                <Card styles={{ body: { padding: token.paddingSM } }}>
                    <div style={{ display: "flex", alignItems: "center", gap: token.marginSM }}>
                        <FilePdfOutlined style={{ fontSize: 20, color: token.colorError }} />
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <Typography.Text strong ellipsis style={{ display: "block" }}>
                                {customizedFrom.name}
                                <Tag color="processing" style={{ marginLeft: token.marginXS }}>
                                    Edited for this document
                                </Tag>
                            </Typography.Text>
                            <Typography.Text
                                type="secondary"
                                style={{ fontSize: token.fontSizeSM }}
                            >
                                {fieldCount} field{fieldCount === 1 ? "" : "s"} · your changes apply
                                to this document only — the template in the library is untouched
                            </Typography.Text>
                        </div>
                        <Button onClick={onStopCustomizing}>Use the template as it is</Button>
                    </div>
                </Card>
            ) : documentSource === "template" ? (
                isLoading ? (
                    <div
                        style={{
                            display: "flex",
                            justifyContent: "center",
                            padding: token.paddingXL,
                        }}
                    >
                        <Spin />
                    </div>
                ) : templates.length === 0 ? (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description="No templates yet — upload a document instead."
                    />
                ) : (
                    <div>
                        <Typography.Text
                            strong
                            style={{ display: "block", marginBottom: token.marginXS }}
                        >
                            Template
                        </Typography.Text>
                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                                gap: token.marginSM,
                            }}
                        >
                            {templates.map((t) => (
                                <Card
                                    key={t.id}
                                    hoverable
                                    onClick={() => onSelect(t.id)}
                                    styles={{ body: { padding: token.paddingSM } }}
                                    style={{
                                        cursor: "pointer",
                                        borderColor:
                                            t.id === selectedTemplateId
                                                ? token.colorPrimary
                                                : undefined,
                                        borderWidth: t.id === selectedTemplateId ? 2 : 1,
                                    }}
                                >
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: token.marginSM,
                                        }}
                                    >
                                        <FilePdfOutlined
                                            style={{ fontSize: 20, color: token.colorError }}
                                        />
                                        <div style={{ minWidth: 0 }}>
                                            <Typography.Text
                                                strong
                                                ellipsis
                                                style={{ display: "block" }}
                                            >
                                                {t.name}
                                            </Typography.Text>
                                            {!t.pdf_file_path && (
                                                <Typography.Text
                                                    type="secondary"
                                                    style={{ fontSize: token.fontSizeSM }}
                                                >
                                                    no PDF uploaded
                                                </Typography.Text>
                                            )}
                                        </div>
                                    </div>
                                </Card>
                            ))}
                        </div>
                        {selectedTemplateId && !hasPdf && (
                            <Alert
                                type="warning"
                                showIcon
                                style={{ marginTop: token.marginSM }}
                                message="This template has no PDF yet, so there is nothing to send."
                            />
                        )}

                        {/* Offered only once a usable template is chosen, and
                            phrased as what it does rather than as "edit template":
                            the library row is not what gets edited, and a sender who
                            believed otherwise would be afraid to touch it — or worse,
                            would not be, and would expect their change to stick for
                            next time. */}
                        {selectedTemplateId && hasPdf && (
                            <div
                                style={{
                                    marginTop: token.marginSM,
                                    display: "flex",
                                    alignItems: "center",
                                    gap: token.marginSM,
                                    flexWrap: "wrap",
                                }}
                            >
                                <Button loading={isCustomizing} onClick={onCustomize}>
                                    Edit fields for this document
                                </Button>
                                <Typography.Text
                                    type="secondary"
                                    style={{ fontSize: token.fontSizeSM }}
                                >
                                    Move, add or remove fields on a copy — this document only. The
                                    template stays as it is for everyone else.
                                </Typography.Text>
                            </div>
                        )}
                    </div>
                )
            ) : pendingPdfFile || uploadedPdfPath ? (
                <Card styles={{ body: { padding: token.paddingSM } }}>
                    <div style={{ display: "flex", alignItems: "center", gap: token.marginSM }}>
                        <FilePdfOutlined style={{ fontSize: 20, color: token.colorError }} />
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <Typography.Text strong ellipsis style={{ display: "block" }}>
                                {pendingPdfFile?.name ?? "Uploaded document"}
                            </Typography.Text>
                            <Typography.Text
                                type="secondary"
                                style={{ fontSize: token.fontSizeSM }}
                            >
                                {pendingPdfFile
                                    ? `${(pendingPdfFile.size / 1024 / 1024).toFixed(1)}MB · fields are placed in the next step`
                                    : "Stored — fields are placed in the next step"}
                            </Typography.Text>
                        </div>
                        <Button icon={<DeleteOutlined />} onClick={onRemovePdf}>
                            Remove
                        </Button>
                    </div>
                </Card>
            ) : (
                <Upload.Dragger
                    accept="application/pdf"
                    beforeUpload={handleBeforeUpload}
                    showUploadList={false}
                    maxCount={1}
                >
                    <p className="ant-upload-drag-icon">
                        <InboxOutlined />
                    </p>
                    <p className="ant-upload-text">Click or drag a PDF here</p>
                    <p className="ant-upload-hint">
                        Up to {MAX_UPLOAD_SIZE_MB}MB. You will place the signature and information
                        fields on it in the next step.
                    </p>
                </Upload.Dragger>
            )}

            {/* The title gates Next in BOTH modes (see `canProceed`), so it is marked
                required in both. It went unmarked for a long time, which meant an
                empty title read as a broken button rather than as a missing field. */}
            <div style={{ maxWidth: 480 }}>
                <Typography.Text strong style={{ display: "block", marginBottom: token.marginXS }}>
                    <Typography.Text type="danger">*</Typography.Text> Document title
                </Typography.Text>
                <Input
                    placeholder="What the recipient sees in their inbox"
                    value={title}
                    status={titleMissing ? "error" : undefined}
                    onChange={(e) => onTitleChange(e.target.value)}
                    // Tabbing straight past the field is the commonest way to arrive at
                    // a disabled Next, so blur counts as having seen it.
                    onBlur={onTitleBlur}
                />
                <Typography.Text
                    type={titleMissing ? "danger" : "secondary"}
                    style={{ fontSize: token.fontSizeSM }}
                >
                    {titleMissing
                        ? "A title is required — recipients see it in their email."
                        : "Recipients see this in their email and document list."}
                </Typography.Text>
            </div>
        </div>
    );
};

// ============================================================
// Step 3 — fill your part, check, send
// ============================================================

type StepPrepareProps = {
    title: string;
    templateName: string;
    recipients: {
        role: { id: string; name: string; color: string; order: number };
        recipient?: EnvelopeRecipient;
    }[];
    cc: EnvelopeCcRecipient[];
    fields: Signing_Field[];
    senderFieldCount: number;
    fieldValues: Record<string, unknown>;
    onFieldChange: (fieldId: string, value: unknown) => void;
    errors: Record<string, string>;
    roleColors: Record<string, string>;
    pdfUrl: string | null;
    pdfLoading: boolean;
    schedule: EnvelopeSchedule;
    onScheduleChange: (patch: Partial<EnvelopeSchedule>) => void;
};

const StepPrepare = ({
    title,
    templateName,
    recipients,
    cc,
    fields,
    senderFieldCount,
    fieldValues,
    onFieldChange,
    errors,
    roleColors,
    pdfUrl,
    pdfLoading,
    schedule,
    onScheduleChange,
}: StepPrepareProps) => {
    const { token } = theme.useToken();
    // Frozen for this render pass rather than read inside the editor: the
    // "deadline must be in the future" check and the day-offset arithmetic both
    // measure from the same instant, and letting them drift by a render would
    // make a just-set deadline briefly invalid.
    const now = useMemo(() => utils_Envelope_ScheduleNow(), []);

    return (
        <div style={{ display: "flex", gap: token.marginMD, height: "100%", minHeight: 0 }}>
            <div
                style={{
                    width: 300,
                    minWidth: 300,
                    overflow: "auto",
                    display: "flex",
                    flexDirection: "column",
                    gap: token.marginMD,
                }}
            >
                <Descriptions column={1} size="small" bordered title="Summary">
                    <Descriptions.Item label="Title">{title}</Descriptions.Item>
                    <Descriptions.Item label="Template">{templateName}</Descriptions.Item>
                    <Descriptions.Item label="Your fields">
                        {senderFieldCount > 0 ? (
                            <Tag color="blue">{senderFieldCount}</Tag>
                        ) : (
                            <Typography.Text type="secondary">None</Typography.Text>
                        )}
                    </Descriptions.Item>
                </Descriptions>

                <div style={{ display: "flex", flexDirection: "column", gap: token.marginXS }}>
                    <Typography.Text strong>Signers</Typography.Text>
                    {recipients.map(({ role, recipient }) => (
                        <div key={role.id} style={{ display: "flex", flexDirection: "column" }}>
                            {/* `flexWrap` and the name's `minWidth: 0` are both
                                load-bearing in a 300px column. An ANTD `Tag`
                                sets `white-space: nowrap` and so refuses to
                                shrink; without a wrap the Tags win the width
                                fight and squeeze the name to a single character
                                per line. Wrapping lets a Tag drop to its own row
                                instead, and `minWidth: 0` lets the name break at
                                the column edge — names arrive from a text input
                                and can legitimately be one long unbroken
                                string. */}
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    flexWrap: "wrap",
                                    gap: token.marginXS,
                                }}
                            >
                                <Tag color={role.color} style={{ margin: 0 }}>
                                    {role.name}
                                </Tag>
                                <Typography.Text style={{ minWidth: 0, wordBreak: "break-word" }}>
                                    {recipient?.name}
                                </Typography.Text>
                                {/* ONLY on an exception — CG-032.
                                    This is now a SUMMARY rather than a
                                    reconciliation. While the default lived on
                                    this step and the exceptions lived on the
                                    previous one, this Tag was load-bearing: it
                                    was the only thing stopping two controls in
                                    two steps from silently disagreeing. Both now
                                    sit together on the Recipients step, so the
                                    sender has already seen the exception where
                                    they set it — this just carries it into the
                                    last look before sending, which is what every
                                    other row in this summary does.

                                    `shortLabel`, never `label`: the radio
                                    group's copy is a sentence, and a sentence in
                                    a Tag is what broke this row's layout. */}
                                {recipient?.auth_method && (
                                    <Tag
                                        color={
                                            utils_Envelope_SignerAuthOption(recipient.auth_method)
                                                .color
                                        }
                                        style={{ margin: 0 }}
                                    >
                                        {
                                            utils_Envelope_SignerAuthOption(recipient.auth_method)
                                                .shortLabel
                                        }
                                    </Tag>
                                )}
                            </div>
                            <Typography.Text
                                type="secondary"
                                style={{ fontSize: token.fontSizeSM, wordBreak: "break-word" }}
                            >
                                {recipient?.email}
                            </Typography.Text>
                        </div>
                    ))}
                </div>

                {/* Listed separately, and after, because they are not parties to
                    the agreement — an observer shown among the signers reads as
                    someone the document is waiting on. */}
                {cc.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: token.marginXS }}>
                        <Typography.Text strong>Copy to</Typography.Text>
                        {cc.map((observer) => (
                            <div
                                key={observer.key}
                                style={{ display: "flex", flexDirection: "column" }}
                            >
                                <div
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: token.marginXS,
                                    }}
                                >
                                    <Tag style={{ margin: 0 }}>Observer</Tag>
                                    <Typography.Text>{observer.name}</Typography.Text>
                                </div>
                                <Typography.Text
                                    type="secondary"
                                    style={{ fontSize: token.fontSizeSM }}
                                >
                                    {observer.email} ·{" "}
                                    {observer.notify_on_send
                                        ? "copied now and on completion"
                                        : "copied on completion"}
                                </Typography.Text>
                            </div>
                        ))}
                    </div>
                )}

                {/* Alongside the summary rather than in its own step: the
                    deadline is part of "what am I about to send", the same as
                    the title and the parties, and a fourth step for two controls
                    would push the send button one click further away for the
                    common case where the template's defaults are already right. */}
                <div style={{ display: "flex", flexDirection: "column", gap: token.marginXS }}>
                    <Typography.Text strong>Schedule</Typography.Text>
                    <App_EnvelopeScheduleEditor
                        value={schedule}
                        onChange={onScheduleChange}
                        sentAt={now}
                    />
                </div>

                {/* THE AUTH CONTROLS USED TO LIVE HERE, and were moved to the
                    RECIPIENTS step (CG-032/033).

The original argument for this position was that the deadline,
                    the auth mode and the certification caveat are "one thought:
                    when this document stops being signable, who is allowed to
                    sign it, and what a signature amounts to". That held while the
                    auth mode was a single envelope-wide switch. It stopped holding
                    the moment CG-032 made it a DEFAULT with per-recipient
                    EXCEPTIONS: a default and its exceptions have to be visible at
                    the same time, and these were a step and a click apart. The
                    reconciliation Tag and the "applies to everyone, unless…" line
                    that used to sit here were mitigations for that split — needing
                    them was the signal the split itself was wrong.

"How recipients sign" is now a property of the RECIPIENTS, on
                    the step where every recipient is on screen at once, which is
                    exactly the context in which "everyone does X, except this one"
                    is legible. The caveat below still says what a signature
                    amounts to; it does not need the auth mode beside it to do so. */}

                {/* Plan risk 6: a mock-signed document must never be mistakable
                    for a real one. The burn is real; the cryptographic signature
                    is not there yet (`_shared/signing.ts` is Phase I), so the
                    sender is told so before they send, not after. */}
                <Alert
                    type="info"
                    showIcon
                    message="Signatures are recorded, not yet certified"
                    description="Completed documents carry field values, signature images, hashes and a verifiable audit chain. Cryptographic (PAdES) signing is not enabled on this deployment."
                />
            </div>

            <div style={{ flex: 1, minHeight: 0 }}>
                {pdfLoading || !pdfUrl ? (
                    <div
                        style={{
                            display: "flex",
                            justifyContent: "center",
                            padding: token.paddingXL,
                        }}
                    >
                        <Spin />
                    </div>
                ) : (
                    <App_DocumentFiller
                        pdfUrl={pdfUrl}
                        fields={fields}
                        fieldValues={fieldValues}
                        onChange={onFieldChange}
                        errors={errors}
                        roleColors={roleColors}
                    />
                )}
            </div>
        </div>
    );
};
