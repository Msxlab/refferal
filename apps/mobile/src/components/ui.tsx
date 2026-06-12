import { ReactNode, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { badgeColors, colors, radius, space, text } from '@/theme';

/* ----------------------------------------------------- temel kart */
export function Card({ children, style, glow }: { children: ReactNode; style?: ViewStyle; glow?: boolean }) {
  return (
    <View style={[styles.card, glow && { borderColor: colors.primary, borderWidth: 1 }, style]}>{children}</View>
  );
}

/* ----------------------------------------------------- buton */
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
  style?: ViewStyle;
}) {
  const bg =
    variant === 'ghost'
      ? 'rgba(255,255,255,0.06)'
      : variant === 'danger'
        ? colors.rose
        : variant === 'success'
          ? colors.emerald
          : colors.primary;
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, opacity: off ? 0.5 : pressed ? 0.85 : 1 },
        variant === 'ghost' && { borderWidth: 1, borderColor: colors.borderStrong },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text style={[styles.btnText, variant === 'ghost' && { color: colors.text }]}>{title}</Text>
      )}
    </Pressable>
  );
}

/* ----------------------------------------------------- girdi */
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ marginBottom: space.s4 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.faint}
        style={styles.input}
        accessibilityLabel={label}
        {...props}
      />
    </View>
  );
}

/* ----------------------------------------------------- rozet */
export function Badge({ value }: { value: string }) {
  const c = badgeColors[value] ?? colors.muted;
  return (
    <View style={[styles.badge, { backgroundColor: `${c}22` }]}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c, marginRight: 5 }} />
      <Text style={{ color: c, fontSize: text.xs, fontWeight: '700' }}>{value}</Text>
    </View>
  );
}

/* ----------------------------------------------------- animasyonlu para */
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function MoneyCounter({ cents, currency = 'USD', size = text.hero }: { cents: string | number; currency?: string; size?: number }) {
  const target = Number(cents) / 100;
  const [val, setVal] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    const start = Date.now();
    const dur = 750;
    const id = setInterval(() => {
      const p = Math.min(1, (Date.now() - start) / dur);
      setVal(from + (target - from) * easeOut(p));
      if (p >= 1) {
        fromRef.current = target;
        clearInterval(id);
      }
    }, 16);
    return () => clearInterval(id);
  }, [target]);

  return (
    <Text style={{ color: colors.primary, fontSize: size, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
      {new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(val)}
    </Text>
  );
}

/* ----------------------------------------------------- yatay bar listesi */
export function Bars({ data, format }: { data: Array<{ label: string; value: number; color?: string }>; format?: (v: number) => string }) {
  const top = Math.max(1, ...data.map((d) => d.value));
  return (
    <View style={{ gap: space.s3 }}>
      {data.map((d, i) => (
        <View key={i} accessibilityLabel={`${d.label}: ${format ? format(d.value) : d.value}`}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}>
            <Text style={{ color: colors.muted, fontSize: text.sm }}>{d.label}</Text>
            <Text style={{ color: colors.text, fontSize: text.md, fontWeight: '650' as never }}>
              {format ? format(d.value) : d.value}
            </Text>
          </View>
          <View style={{ height: 9, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
            <View
              style={{
                height: '100%',
                width: `${Math.min(100, (d.value / top) * 100)}%`,
                borderRadius: 6,
                backgroundColor: d.color ?? colors.primary,
              }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

/* ----------------------------------------------------- durum metinleri */
export function ErrorText({ children }: { children: ReactNode }) {
  return <Text style={{ color: colors.rose, fontSize: text.md, marginVertical: space.s2 }}>{children}</Text>;
}

export function MutedText({ children, size = text.sm }: { children: ReactNode; size?: number }) {
  return <Text style={{ color: colors.muted, fontSize: size }}>{children}</Text>;
}

export function Title({ eyebrow, title, sub }: { eyebrow?: string; title: string; sub?: string }) {
  return (
    <View style={{ marginBottom: space.s5 }}>
      {eyebrow && (
        <Text style={{ color: colors.primary, fontSize: text.xs, fontWeight: '800', letterSpacing: 1.4, textTransform: 'uppercase' }}>
          {eyebrow}
        </Text>
      )}
      <Text style={{ color: colors.text, fontSize: text.xl, fontWeight: '800', marginTop: 2 }}>{title}</Text>
      {sub && <Text style={{ color: colors.muted, fontSize: text.md, marginTop: 4 }}>{sub}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.s5,
    marginBottom: space.s4,
  },
  btn: {
    borderRadius: radius.md,
    paddingVertical: 13,
    paddingHorizontal: space.s5,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  btnText: { color: '#fff', fontSize: text.md, fontWeight: '700' },
  label: { color: colors.muted, fontSize: text.sm, fontWeight: '600', marginBottom: 6 },
  input: {
    backgroundColor: 'rgba(10,12,24,0.7)',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 13,
    paddingVertical: 11,
    color: colors.text,
    fontSize: 15,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
});
