import React, { createContext, useContext } from 'react';
import type { MD3Theme } from 'react-native-paper';

type ThemeUpdateContextType = {
  setTheme: (t: MD3Theme) => void;
};

const ThemeUpdateContext = createContext<ThemeUpdateContextType>({ setTheme: () => {} });

export const ThemeUpdateProvider = ThemeUpdateContext.Provider;
export const useThemeUpdate = () => useContext(ThemeUpdateContext);