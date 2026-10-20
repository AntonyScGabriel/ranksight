import { View, type StyleProp, type ViewStyle } from "react-native";
import { WebView } from "react-native-webview";

/** Origine déclarée au lecteur YouTube (il refuse de se lancer sans page d'accueil identifiée) */
const ORIGIN = "https://rankguess.fr";

/**
 * Clip proposé par un lien : lecteur intégré YouTube / Medal (adresse fournie par l'API, limitée au passage choisi).
 * Toute navigation hors du lecteur est bloquée : le logo et le titre ne mènent pas à la page d'origine de la vidéo
 * (description, commentaires…), qui pourrait révéler le rang.
 */
export function LinkClipView({ url, style }: { url: string; style?: StyleProp<ViewStyle> }) {
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:#000}iframe{border:0;width:100%;height:100%}</style></head><body><iframe src="${url.replace(/"/g, "&quot;")}" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe></body></html>`;
  return (
    <View style={[{ flex: 1, backgroundColor: "black" }, style]}>
      <WebView
        source={{ html, baseUrl: ORIGIN }}
        originWhitelist={["*"]}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        allowsFullscreenVideo
        setSupportMultipleWindows={false}
        onShouldStartLoadWithRequest={(r) => !r.isTopFrame || r.url === "about:blank" || r.url.startsWith(ORIGIN)}
        style={{ flex: 1, backgroundColor: "black" }}
      />
    </View>
  );
}
