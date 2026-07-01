export interface ChunkUploadPayload {
  reportId: string;
  chunkId: string;
  chunkIndex: number;
  byteStart: number;
  byteEnd: number;
  sha256: string;
  binaryData: Buffer;
}

export interface UploadResult {
  success: boolean;
  statusCode?: number;
  errorMessage?: string;
}

export interface INetworkClient {
  /**
   * Performs an mTLS upload of a single chunk payload to /api/v1/media/upload-chunk.
   * Throws transport/socket errors or returns an UploadResult.
   */
  uploadChunk(payload: ChunkUploadPayload): Promise<UploadResult>;
}
