import type { SupabaseClient } from "@supabase/supabase-js";

export type EnsureStorageBucketOptions = {
  public: boolean;
  fileSizeLimit?: number;
  allowedMimeTypes?: string[];
};

export async function ensureStorageBucket(
  supabase: SupabaseClient,
  bucket: string,
  options: EnsureStorageBucketOptions,
) {
  const { data, error } = await supabase.storage.getBucket(bucket);
  if (data && !error) {
    return data;
  }

  const bucketMissing = !data && error && /Bucket not found|not found|404/i.test(error.message);
  if (!bucketMissing) {
    throw new Error(error?.message ?? `Unable to access bucket ${bucket}`);
  }

  const { data: created, error: createError } = await supabase.storage.createBucket(bucket, {
    public: options.public,
    fileSizeLimit: options.fileSizeLimit ?? null,
    allowedMimeTypes: options.allowedMimeTypes ?? null,
  });

  if (createError || !created) {
    throw new Error(createError?.message ?? `Unable to create bucket ${bucket}`);
  }

  return created;
}
