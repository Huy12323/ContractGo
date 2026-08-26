/**
 * Stub for the AWS SDK packages that supabase/functions/_shared/storage.ts
 * dynamically imports inside `createR2Driver()`.
 *
 * Those imports are never *executed* in the unit silo — deno-shim.ts sets
 * STORAGE_DRIVER=local, so only `createLocalDriver()` is ever constructed. But
 * Vite's static import-analysis still has to resolve the specifier, and the AWS
 * SDK is a ROOT devDependency that pnpm does not expose to @contractgo/web.
 *
 * Installing the real SDK into the web package to satisfy a code path that
 * cannot run would put a large dependency in the app's tree for no runtime
 * reason. Aliasing to this stub is the faithful option: if a test ever does
 * reach the R2 driver it throws here with a message saying so, rather than
 * silently succeeding against a half-real client.
 *
 * Signatures are deliberately permissive — this is a resolution placeholder, not
 * a type contract. `deno check` (pnpm check:ef) type-checks the real driver
 * against the real SDK.
 */

const unreachable = (name: string): never => {
    throw new Error(
        `[test-stub] ${name} was used. The unit silo runs with STORAGE_DRIVER=local, ` +
            `so the R2 driver should be unreachable. Code needing real S3/R2 ` +
            `belongs in the integration silo.`
    );
};

class StubCommand {
    constructor(..._args: unknown[]) {
        unreachable(new.target.name);
    }
}

export class S3Client {
    constructor(..._args: unknown[]) {
        unreachable("S3Client");
    }
    // Callers destructure real SDK response shapes (`Body`, etc.). This is a
    // resolution placeholder, not a type contract — `deno check` validates the
    // real driver against the real SDK.
    send(..._args: unknown[]): Promise<Record<string, { transformToByteArray(): Uint8Array }>> {
        return unreachable("S3Client#send");
    }
}

export class GetObjectCommand extends StubCommand {}
export class PutObjectCommand extends StubCommand {}
export class HeadObjectCommand extends StubCommand {}
export class DeleteObjectCommand extends StubCommand {}
export class ListObjectsV2Command extends StubCommand {}

export const getSignedUrl = (..._args: unknown[]): Promise<string> => unreachable("getSignedUrl");
