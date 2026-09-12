import { createServerFn } from '@tanstack/react-start'
import { authPolicy } from '#/auth/policy'

export const getPublicAuthPolicy = createServerFn({ method: 'GET' }).handler(
  () => {
    const policy = authPolicy()
    return {
      registrationMode: policy.REGISTRATION_MODE,
      ssoRegistrationMode: policy.SSO_REGISTRATION_MODE,
      passwordEnabled: policy.AUTH_MODE !== 'sso',
    }
  },
)
