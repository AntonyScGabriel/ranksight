import { StyleSheet, type ScrollViewProps, type StyleProp, type ViewStyle } from "react-native";
import { KeyboardAvoidingView, KeyboardAwareScrollView } from "react-native-keyboard-controller";

/** Espace gardé entre le champ actif et le haut du clavier */
const MARGIN = 24;

/**
 * Écran dont le bas (champ de saisie d'un chat…) remonte au-dessus du clavier.
 * Fonctionne avec l'affichage bord à bord d'Android (l'écran n'est plus redimensionné par le système) ; la position
 * réelle de l'écran (en-tête, barre d'onglets) est mesurée automatiquement.
 */
export function KeyboardView({ style, children }: { style?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  return (
    <KeyboardAvoidingView behavior="padding" automaticOffset style={[styles.fill, style]}>
      {children}
    </KeyboardAvoidingView>
  );
}

/** Formulaire défilant : le clavier ne cache jamais le champ en cours de saisie */
export function KeyboardScroll({ style, children, ...props }: ScrollViewProps & { children: React.ReactNode }) {
  return (
    <KeyboardAwareScrollView bottomOffset={MARGIN} keyboardShouldPersistTaps="handled" style={[styles.fill, style]} {...props}>
      {children}
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
