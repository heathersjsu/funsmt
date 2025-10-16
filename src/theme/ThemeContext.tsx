import React, { createContext, useContext } from 'react';
import type { MD3LightTheme } from 'react-native-paper';

type ThemeUpdateContextType = {
  setTheme: (t: MD3LightTheme) => void;
};

const ThemeUpdateContext = createContext<ThemeUpdateContextType>({ setTheme: () => {} });

export const ThemeUpdateProvider = ThemeUpdateContext.Provider;
export const useThemeUpdate = () => useContext(ThemeUpdateContext);