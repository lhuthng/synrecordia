import { useContext } from "react";
import MobileMenuContext from "./MobileMenuContext";

export function useMobileMenu() {
  return useContext(MobileMenuContext);
}
