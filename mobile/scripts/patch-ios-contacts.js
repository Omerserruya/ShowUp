// iOS 18 lets the user share only SOME contacts (CNAuthorizationStatus.limited,
// raw value 4). @capacitor-community/contacts 6.1.1 treats it as "not granted",
// so getContacts fails even though the user said yes. Treat limited as granted.
// Runs on postinstall; idempotent.
const fs = require('fs');
const path = require('path');
const f = path.join(__dirname, '..', 'node_modules', '@capacitor-community', 'contacts', 'ios', 'Plugin', 'ContactsPlugin.swift');
if (!fs.existsSync(f)) process.exit(0);
let s = fs.readFileSync(f, 'utf8');
if (s.includes('SHOWUP_LIMITED_PATCH')) process.exit(0);
const before = s;
// checkPermissions: limited -> "granted"
s = s.replace(
  /case \.authorized:\n(\s*)permissionState = "granted"\n(\s*)@unknown default:\n(\s*)permissionState = "prompt"/,
  (m, a, b, c) => `case .authorized:\n${a}permissionState = "granted"\n${b}@unknown default: // SHOWUP_LIMITED_PATCH\n${c}permissionState = CNContactStore.authorizationStatus(for: .contacts).rawValue == 4 ? "granted" : "prompt"`
);
// isContactsPermissionGranted: limited -> true
s = s.replace(
  /case \.authorized:\n(\s*)return true\n(\s*)@unknown default:\n(\s*)return false/,
  (m, a, b, c) => `case .authorized:\n${a}return true\n${b}@unknown default:\n${c}return CNContactStore.authorizationStatus(for: .contacts).rawValue == 4`
);
if (s === before || (s.match(/rawValue == 4/g) || []).length !== 2) {
  console.error('patch-ios-contacts: pattern not found - plugin changed?');
  process.exit(1);
}
fs.writeFileSync(f, s);
console.log('patch-ios-contacts: applied');
