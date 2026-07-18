const fs = require('fs');
const path = require('path');

const mobileRoot = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(mobileRoot, relativePath), 'utf8');
const collect = (relativePath) => {
  const fullPath = path.join(mobileRoot, relativePath);
  return fs.readdirSync(fullPath, { withFileTypes: true }).flatMap((entry) => {
    const childPath = path.join(relativePath, entry.name);
    return entry.isDirectory() ? collect(childPath) : /\.(?:ts|tsx)$/.test(entry.name) ? [childPath] : [];
  });
};
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const theme = read('src/theme.ts');
const appConfig = read('app.json');
const expoConfig = JSON.parse(appConfig).expo;
const rootLayout = read('app/_layout.tsx');
const ui = read('src/components/ui.tsx');
const tabsLayout = read('app/(tabs)/_layout.tsx');
const login = read('app/login.tsx');
const mfaSetup = read('app/mfa-setup.tsx');
const privileged = read('app/privileged.tsx');
const inviteRegistration = read('app/i/[code].tsx');
const brandAsset = path.join(mobileRoot, 'assets', 'refearn-network-mark-v1.png');

assert(theme.includes('ThemeProvider'), 'ThemeProvider must own the system-preference mobile palette.');
assert(theme.includes('useTheme'), 'Screens and shared components need a semantic useTheme hook.');
assert(theme.includes('useColorScheme'), 'The provider must follow the operating system color scheme.');
assert(theme.includes('lightColors') && theme.includes('darkColors'), 'Both light and dark semantic palettes are required.');
assert(theme.includes('const [reducedMotion, setReducedMotion] = useState(true);'), 'Reduced-motion must be safe by default until the native preference is known.');
assert(appConfig.includes('"userInterfaceStyle": "automatic"'), 'Expo must permit the operating system light or dark preference.');
assert(expoConfig.backgroundColor === '#F5F7FB', 'The native root background must match the light semantic surface.');
assert(expoConfig.splash?.backgroundColor === '#F5F7FB', 'The base splash background must match the light semantic surface.');
for (const platform of ['android', 'ios']) {
  assert(expoConfig[platform]?.splash?.backgroundColor === '#F5F7FB', `${platform} splash must define the light semantic surface.`);
  assert(expoConfig[platform]?.splash?.dark?.backgroundColor === '#0B1324', `${platform} splash must define the dark semantic surface.`);
}
assert(rootLayout.includes('ThemeProvider'), 'The root navigator must be rendered inside ThemeProvider.');
assert(rootLayout.includes('useTheme'), 'StatusBar and navigator surfaces must consume the active theme.');
assert(ui.includes('useTheme'), 'Shared mobile primitives must consume semantic colors.');
assert(ui.includes('refearn-network-mark-v1.png'), 'The canonical Brand must use the generated raster mark.');
assert(ui.includes('accessibilityLabel={busy ? `${title}, loading` : title}'), 'Busy buttons must retain an accessible action name.');
assert(ui.includes('alpha(color, 0.1)'), 'Badge subtle surfaces must preserve AA small-text contrast.');
for (const [name, source] of [['login', login], ['MFA setup', mfaSetup], ['privileged', privileged], ['invite registration', inviteRegistration]]) {
  assert(source.includes('<Brand'), `${name} must use the canonical raster brand presentation.`);
}
assert(tabsLayout.includes('tabBarShowIcon: false') && !tabsLayout.includes('glyph="'), 'The tab bar must not ship placeholder ASCII glyph icons.');
assert(fs.existsSync(brandAsset), 'The generated raster mark must be available to the native bundle.');

const mobileSource = [...collect('app'), ...collect('src')]
  .filter((relativePath) => relativePath !== 'src/theme.ts')
  .map(read)
  .join('\n');
for (const legacy of ['#D4AF37', '#d4af37', '#08090d', 'rgba(212, 175, 55', 'APP_MONOGRAM}</Text>']) {
  assert(!mobileSource.includes(legacy), `Legacy mobile visual token remains: ${legacy}`);
}
assert(!mobileSource.includes('activeBrand.primaryColor'), 'Runtime tenant color may not override a semantic mobile token.');
assert(!mobileSource.includes("import { colors"), 'Screens must use the semantic theme hook rather than a static palette.');

const hex = (value) => value.match(/\w\w/g).map((pair) => Number.parseInt(pair, 16) / 255);
const luminance = (value) => hex(value.slice(1))
  .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
  .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
const blend = (foreground, background, opacity) => {
  const fg = hex(foreground.slice(1)).map((channel) => Math.round(channel * 255));
  const bg = hex(background.slice(1)).map((channel) => Math.round(channel * 255));
  return `#${fg.map((channel, index) => Math.round(channel * opacity + bg[index] * (1 - opacity)).toString(16).padStart(2, '0')).join('')}`;
};
const pairs = [
  ['#17233B', '#F5F7FB'], ['#53627A', '#F5F7FB'], ['#53627A', '#FFFFFF'], ['#65718A', '#F5F7FB'], ['#65718A', '#FFFFFF'], ['#FFFFFF', '#384BB8'], ['#FFFFFF', '#0E7A5F'], ['#FFFFFF', '#9A570F'], ['#FFFFFF', '#B5364B'], ['#3458C5', '#FFFFFF'],
  ['#F0F4FF', '#0B1324'], ['#B3C0D7', '#0B1324'], ['#B3C0D7', '#131F31'], ['#8394B0', '#0B1324'], ['#8394B0', '#152236'], ['#0E1835', '#A9B8FF'], ['#062E26', '#55D4AD'], ['#352109', '#F0B46A'], ['#2C1020', '#FF9AA7'], ['#AABAFF', '#131F31'], ['#0C1D52', '#A9B8FF'],
];
for (const [foreground, background] of pairs) {
  assert(contrast(foreground, background) >= 4.5, `AA contrast regression: ${foreground} on ${background}`);
}
for (const [foreground, surface] of [
  ['#0E7A5F', '#FFFFFF'], ['#9A570F', '#FFFFFF'], ['#B5364B', '#FFFFFF'], ['#3458C5', '#FFFFFF'], ['#53627A', '#FFFFFF'],
  ['#55D4AD', '#131F31'], ['#F0B46A', '#131F31'], ['#FF9AA7', '#131F31'], ['#AABAFF', '#131F31'], ['#B3C0D7', '#131F31'],
]) {
  assert(contrast(foreground, blend(foreground, surface, 0.1)) >= 4.5, `AA badge contrast regression: ${foreground}`);
}

console.log(`mobile quiet-fintech theme architecture and contrast assertions passed (${pairs.length} AA pairs plus badge pairs)`);
