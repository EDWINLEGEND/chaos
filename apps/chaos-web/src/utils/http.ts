import type http from 'node:http';

export function sendJson(res: http.ServerResponse, statusCode: number, data: unknown): void {
  const payload = JSON.stringify(data);
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(statusCode);
  res.end(payload);
}

export function sendError(
  res: http.ServerResponse,
  statusCode: number,
  code: string,
  message: string
): void {
  sendJson(res, statusCode, {
    error: {
      code,
      message,
    },
  });
}

export async function parseJsonBody<T = Record<string, unknown>>(
  req: http.IncomingMessage,
  maxSizeBytes: number = 65536
): Promise<T> {
  return new Promise((resolve, reject) => {
    let raw = '';
    let bytes = 0;

    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxSizeBytes) {
        reject(new Error('Payload Too Large: exceeded 64KB maximum limit'));
        return;
      }
      raw += chunk.toString('utf-8');
    });

    req.on('end', () => {
      if (!raw || raw.trim().length === 0) {
        resolve({} as T);
        return;
      }
      try {
        const parsed = JSON.parse(raw) as T;
        resolve(parsed);
      } catch (err) {
        reject(new Error(`Invalid JSON payload: ${err instanceof Error ? err.message : String(err)}`));
      }
    });

    req.on('error', (err) => {
      reject(err);
    });
  });
}
