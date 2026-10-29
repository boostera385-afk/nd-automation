"use client";

import { createContext, useContext, type ReactNode } from "react";
import { WORKSPACE_FORM_FIELD } from "@/lib/workspace-selection";

const WorkspaceContext = createContext("");

export function WorkspaceProvider({ value, children }: { value: string; children: ReactNode }) {
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspaceContext() { return useContext(WorkspaceContext); }

export function WorkspaceField() {
  const value = useWorkspaceContext();
  return <input type="hidden" name={WORKSPACE_FORM_FIELD} value={value} />;
}
