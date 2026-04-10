import { createFileRoute, useParams } from '@tanstack/react-router'
import { Page_OnboardingFiller } from '@/pages/Page_OnboardingFiller/Page_OnboardingFiller'

export const Route = createFileRoute('/_protected/onboarding/$invitationToken')({
  component: RouteComponent,
})

function RouteComponent() {
  const { invitationToken } = useParams({ from: '/_protected/onboarding/$invitationToken' })
  return <Page_OnboardingFiller invitationToken={invitationToken} />
}
