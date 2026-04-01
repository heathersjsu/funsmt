// Web shim for permissions: provide minimal stubs so bundling succeeds on web.
// Always return GRANTED to avoid blocking UI flows; native builds will enforce real permissions.
export const RESULTS = { GRANTED: 'granted' } as any;
export const PERMISSIONS = { ANDROID: {} } as any;
export async function check(_perm: any) { return RESULTS.GRANTED; }
export async function request(_perm: any) { return RESULTS.GRANTED; }
const Permissions = { PERMISSIONS, RESULTS, check, request } as any;
export default Permissions;