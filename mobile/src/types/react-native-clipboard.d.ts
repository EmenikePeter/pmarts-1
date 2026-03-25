// Minimal module declaration for @react-native-clipboard/clipboard
declare module '@react-native-clipboard/clipboard' {
  export function setString(text: string): void;
  export function getString(): Promise<string>;
  const Clipboard: { setString(text: string): void; getString(): Promise<string> };
  export default Clipboard;
}
