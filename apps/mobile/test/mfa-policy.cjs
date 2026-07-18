const fs = require('fs');
const path = require('path');

const auth = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'lib', 'auth.ts'), 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

assert(
  /DEFAULT_MFA_SETUP_ROLES\s*=\s*\[[^\]]*'tenant_staff'/.test(auth),
  'tenant_staff must require MFA by default before the privileged mobile handoff.',
);
assert(
  auth.includes('process.env.EXPO_PUBLIC_MFA_REQUIRED_ROLES') && auth.includes("raw ?? DEFAULT_MFA_SETUP_ROLES.join(',')"),
  'EXPO_PUBLIC_MFA_REQUIRED_ROLES must continue to override the default MFA role set.',
);
assert(
  auth.includes("raw?.trim().toLowerCase() === 'none'"),
  'The explicit MFA override escape hatch must remain available.',
);

console.log('mobile MFA policy assertions passed');
