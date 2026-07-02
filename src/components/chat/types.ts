import type { Id } from "../../../convex/_generated/dataModel";

export type Me = {
  _id: Id<"users">;
  username: string;
  status: "active" | "banned" | "suspended";
  lastActiveAt: number | null;
  role: "user" | "admin";
};

export type PendingMessage = {
  key: string;
  type: "text" | "image";
  text: string | null;
  imagePreviewUrl: string | null;
  failed: boolean;
};
