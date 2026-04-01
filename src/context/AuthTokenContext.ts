import React from 'react';

export type AuthTokenContextValue = {
  userJwt: string | null;
  setUserJwt: (token: string | null) => void;
};

export const AuthTokenContext = React.createContext<AuthTokenContextValue>({
  userJwt: null,
  setUserJwt: () => {},
});