"use client";

import { createContext, useContext } from "react";

export interface OrgInfo {
  id: string;
  name: string;
  slug: string;
  rif: string | null;
  address: string | null;
  baseCurrency: string;
  igtfRate: string;
  role: "owner" | "admin" | "cashier" | "accountant";
  rates: {
    usdToVes: string | null;
    eurToVes: string | null;
  };
}

const OrgContext = createContext<OrgInfo | null>(null);

export function OrgProvider({
  value,
  children,
}: {
  value: OrgInfo;
  children: React.ReactNode;
}) {
  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg(): OrgInfo {
  const ctx = useContext(OrgContext);
  if (!ctx) {
    throw new Error("useOrg debe usarse dentro de OrgProvider");
  }
  return ctx;
}
