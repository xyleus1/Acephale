export function resolveSupplyWorkspaceId(args: {
  workspaces: ReadonlyArray<{ id: string }>;
  fixedWorkspaceId?: string | null;
  preferredWorkspaceId?: string | null;
  currentWorkspaceId?: string | null;
}) {
  if (args.fixedWorkspaceId) {
    if (!args.workspaces.some((workspace) => workspace.id === args.fixedWorkspaceId)) {
      throw new Error("The selected workspace is no longer available to this user.");
    }
    return args.fixedWorkspaceId;
  }
  if (
    args.preferredWorkspaceId
    && args.workspaces.some((workspace) => workspace.id === args.preferredWorkspaceId)
  ) return args.preferredWorkspaceId;
  if (
    args.currentWorkspaceId
    && args.workspaces.some((workspace) => workspace.id === args.currentWorkspaceId)
  ) return args.currentWorkspaceId;
  return args.workspaces[0]?.id ?? "";
}
