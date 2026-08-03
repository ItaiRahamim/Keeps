// Shared data-shape contract for the Keeps app.
// This file is consumed verbatim by the Backend & Storage, Client Logic, and
// UI/UX agents. Do not change these shapes without coordinating — see
// AGENTS.md / the infra agent's task spec for details.

export type MediaRow = {
  id: string;
  user_id: string;
  media_type: 'image' | 'video';
  original_url: string;
  thumbnail_url: string | null;
  thumbnail_data: string | null;
  caption: string | null;
  lat_lng: { x: number; y: number } | null;
  cluster_id: string | null;
  pos_x: number;
  pos_y: number;
  rotation: number;
  z_index: number;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  created_at: string;
};

export type ClusterRow = {
  id: string;
  name: string;
  cover_media_id: string | null;
  created_at: string;
};
