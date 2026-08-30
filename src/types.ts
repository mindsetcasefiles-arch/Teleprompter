export interface Script {
  id: string;
  title: string;
  content: string;
  createdAt?: any;
  userId?: string;
  tags?: string[];
  folderId?: string | null;
}

export interface Folder {
  id: string;
  name: string;
  userId: string;
  createdAt?: any;
}

export interface ReadingProfile {
  id: string;
  userId: string;
  name: string;
  fontSize: number;
  lineHeight: number;
  contentWidth: string;
  micSensitivity?: number;
  createdAt?: any;
}
