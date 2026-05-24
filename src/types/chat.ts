export type Session = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type Message = {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  model?: string | null;
  reasoningEffort?: string | null;
  generatedImages?: {
    id: string;
    dataUrl: string;
    mimeType: string;
  }[];
  attachments?: {
    id: string;
    filename: string;
    mimeType: string;
    size: number;
    dataUrl?: string;
    previewUrl?: string;
  }[];
};

export type ImageStreamEvent = {
  type?: "partial" | "completed" | "error";
  sessionId?: string;
  image?: {
    dataUrl?: string;
    mimeType?: string;
  };
  error?: string;
};

export type UploadFile = {
  id: string;
  file: File;
  previewUrl?: string;
};
