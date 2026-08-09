import { createContext, useState } from "react";

const MobileMenuContext = createContext({
  extraContent: null,
  setExtraContent: () => {},
});

export function MobileMenuProvider({ children }) {
  const [extraContent, setExtraContent] = useState(null);
  return (
    <MobileMenuContext.Provider value={{ extraContent, setExtraContent }}>
      {children}
    </MobileMenuContext.Provider>
  );
}

export default MobileMenuContext;
