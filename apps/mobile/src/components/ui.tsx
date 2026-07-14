import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { APP_NAME, APP_TAGLINE, normalizeRuntimeBrand, type RuntimeBrand } from '@/lib/brand';
import { alpha, badgeColor, radius, space, text, useReducedMotion, useTheme } from '@/theme';

const networkMark = require('../../assets/refearn-network-mark-v1.png');

/* ----------------------------------------------------- brand */
export function Brand({
  brand,
  size = 'md',
  style,
}: {
  brand?: Partial<RuntimeBrand> | null;
  size?: 'sm' | 'md';
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, scheme } = useTheme();
  const runtimeBrand = brand ? normalizeRuntimeBrand(brand) : null;
  const name = runtimeBrand?.name ?? APP_NAME;
  const tagline = runtimeBrand?.tagline ?? APP_TAGLINE;
  const runtimeAccent = runtimeBrand?.primaryColor ?? colors.brandAccent;
  const markSize = size === 'sm' ? 30 : 38;

  return (
    <View style={[styles.brand, style]}>
      <View
        style={{
          width: markSize,
          height: markSize,
          borderRadius: Math.round(markSize * 0.31),
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: scheme === 'dark' ? colors.primary : 'transparent',
          borderWidth: 1,
          borderColor: alpha(runtimeAccent, 0.46),
          overflow: 'hidden',
        }}
      >
        <Image
          source={networkMark}
          accessible={false}
          accessibilityIgnoresInvertColors
          resizeMode="contain"
          style={{ width: markSize, height: markSize }}
        />
      </View>
      <View style={{ minWidth: 0, flexShrink: 1 }}>
        <Text numberOfLines={1} style={{ color: colors.text, fontSize: size === 'sm' ? text.lg : text.xl, fontWeight: '800' }}>
          {name}
        </Text>
        {size === 'md' ? (
          <Text numberOfLines={2} style={{ color: colors.muted, fontSize: text.sm, marginTop: 2 }}>
            {tagline}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/* ----------------------------------------------------- card */
export function Card({ children, style, glow }: { children: ReactNode; style?: StyleProp<ViewStyle>; glow?: boolean }) {
  const { colors, shadows } = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.panel, borderColor: glow ? colors.primary : colors.border, boxShadow: shadows.card },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/* ----------------------------------------------------- button */
export function Button({
  title,
  onPress,
  variant = 'primary',
  busy,
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost' | 'danger' | 'success';
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  const off = disabled || busy;
  const palette =
    variant === 'ghost'
      ? { backgroundColor: colors.control, foreground: colors.text, borderColor: colors.borderStrong }
      : variant === 'danger'
        ? { backgroundColor: colors.rose, foreground: colors.onRose, borderColor: colors.rose }
        : variant === 'success'
          ? { backgroundColor: colors.emerald, foreground: colors.onEmerald, borderColor: colors.emerald }
          : { backgroundColor: colors.primary, foreground: colors.onPrimary, borderColor: colors.primary };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={busy ? `${title}, loading` : title}
      accessibilityState={{ disabled: off, busy }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: palette.backgroundColor, borderColor: palette.borderColor, opacity: off ? 0.5 : pressed ? 0.9 : 1 },
        pressed && !reducedMotion ? { transform: [{ scale: 0.96 }] } : undefined,
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={palette.foreground} /> : <Text style={[styles.btnText, { color: palette.foreground }]}>{title}</Text>}
    </Pressable>
  );
}

/* ----------------------------------------------------- field */
export function Field({ label, style, ...props }: TextInputProps & { label: string }) {
  const { colors, scheme } = useTheme();
  return (
    <View style={{ marginBottom: space.s4 }}>
      <Text style={[styles.label, { color: colors.muted }]}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.faint}
        selectionColor={colors.primary}
        keyboardAppearance={scheme}
        style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.text }, style]}
        accessibilityLabel={label}
        {...props}
      />
    </View>
  );
}

/* ----------------------------------------------------- badge */
export function Badge({ value }: { value: string }) {
  const { colors } = useTheme();
  const color = badgeColor(colors, value);
  return (
    <View style={[styles.badge, { backgroundColor: alpha(color, 0.1), borderColor: alpha(color, 0.32) }]}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color, marginRight: 5 }} />
      <Text style={{ color, fontSize: text.xs, fontWeight: '700' }}>{value}</Text>
    </View>
  );
}

/* ----------------------------------------------------- animated money */
function easeOut(value: number): number {
  return 1 - Math.pow(1 - value, 3);
}

export function MoneyCounter({ cents, currency = 'USD', size = text.xxl }: { cents: string | number; currency?: string; size?: number }) {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  const target = Number(cents) / 100;
  const [value, setValue] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    if (reducedMotion) {
      fromRef.current = target;
      setValue(target);
      return;
    }
    const from = fromRef.current;
    const start = Date.now();
    const duration = 750;
    const interval = setInterval(() => {
      const progress = Math.min(1, (Date.now() - start) / duration);
      setValue(from + (target - from) * easeOut(progress));
      if (progress >= 1) {
        fromRef.current = target;
        clearInterval(interval);
      }
    }, 16);
    return () => clearInterval(interval);
  }, [reducedMotion, target]);

  return (
    <Text style={{ color: colors.money, fontSize: size, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
      {new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value)}
    </Text>
  );
}

/* ----------------------------------------------------- bars */
export function Bars({ data, format }: { data: Array<{ label: string; value: number; color?: string }>; format?: (value: number) => string }) {
  const { colors } = useTheme();
  const top = Math.max(1, ...data.map((datum) => datum.value));
  return (
    <View style={{ gap: space.s3 }}>
      {data.map((datum, index) => (
        <View key={index} accessibilityLabel={`${datum.label}: ${format ? format(datum.value) : datum.value}`}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}>
            <Text style={{ color: colors.muted, fontSize: text.sm }}>{datum.label}</Text>
            <Text style={{ color: colors.text, fontSize: text.md, fontWeight: '650' as never }}>
              {format ? format(datum.value) : datum.value}
            </Text>
          </View>
          <View style={{ height: 9, borderRadius: 6, backgroundColor: colors.panel3, overflow: 'hidden' }}>
            <View
              style={{
                height: '100%',
                width: `${Math.min(100, (datum.value / top) * 100)}%`,
                borderRadius: 6,
                backgroundColor: datum.color ?? colors.primary,
              }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

/* ----------------------------------------------------- text */
export function ErrorText({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <Text accessibilityLiveRegion="polite" accessibilityRole="alert" selectable style={{ color: colors.rose, fontSize: text.md, marginVertical: space.s2 }}>
      {children}
    </Text>
  );
}

export function MutedText({ children, size = text.sm }: { children: ReactNode; size?: number }) {
  const { colors } = useTheme();
  return <Text style={{ color: colors.muted, fontSize: size }}>{children}</Text>;
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.empty}>
      <Text style={{ color: colors.text, fontSize: text.md, fontWeight: '700' }}>{title}</Text>
      <MutedText size={text.sm}>{detail}</MutedText>
    </View>
  );
}

export function Title({ eyebrow, title, sub }: { eyebrow?: string; title: string; sub?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ marginBottom: space.s5 }}>
      {eyebrow ? (
        <Text style={{ color: colors.primary, fontSize: text.xs, fontWeight: '800', letterSpacing: 1.4, textTransform: 'uppercase' }}>
          {eyebrow}
        </Text>
      ) : null}
      <Text accessibilityRole="header" style={{ color: colors.text, fontSize: text.xl, fontWeight: '800', marginTop: 2 }}>{title}</Text>
      {sub ? <Text style={{ color: colors.muted, fontSize: text.md, marginTop: 4 }}>{sub}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.s5,
    marginBottom: space.s4,
  },
  btn: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: 13,
    paddingHorizontal: space.s5,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  btnText: {
    fontSize: text.md,
    fontWeight: '700',
  },
  label: {
    fontSize: text.sm,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 11,
    minHeight: 46,
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontSize: 15,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  empty: {
    gap: space.s1,
    paddingVertical: space.s3,
  },
});
