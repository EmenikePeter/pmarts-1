export default function dlog(...args: any[]) {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    // eslint-disable-next-line no-console
    console.log(...args);
  }
}

export function dwarn(...args: any[]) {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    // eslint-disable-next-line no-console
    console.warn(...args);
  }
}

export function derror(...args: any[]) {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    // eslint-disable-next-line no-console
    console.error(...args);
  }
}
