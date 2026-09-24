// AWS-style error envelope: `{ "Exception": { "Type": "...", "Message": "..." } }`.
// Optional members tolerate foreign/truncated payloads during deserialization;
// serializers always emit both fields.
interface ErrorResponse {
  Exception?: {
    Type?: string;
    Message?: string;
  };
}

export type { ErrorResponse };
