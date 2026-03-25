import * as React from 'react';
import { CommonActions, NavigationContainerRef, StackActions } from '@react-navigation/native';

export const navigationRef = React.createRef<NavigationContainerRef<any>>();

export function resetToLogin() {
  try {
    navigationRef.current?.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'Login' }],
      })
    );
  } catch (e) {
    // swallow
  }
}

export function replaceToLogin() {
  try {
    // Prefer a stack replace action if available
    navigationRef.current?.dispatch(StackActions.replace('Login'));
  } catch (e) {
    try {
      // Fallback to navigate
      navigationRef.current?.dispatch(CommonActions.navigate('Login'));
    } catch (err) {
      // swallow
    }
  }
}

export default {
  navigationRef,
  resetToLogin,
  replaceToLogin,
};
