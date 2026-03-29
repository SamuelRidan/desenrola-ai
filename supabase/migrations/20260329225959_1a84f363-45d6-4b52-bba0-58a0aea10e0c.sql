-- Allow admins to delete from statements bucket (needed for upsert)
CREATE POLICY "Admins can delete statements"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'statements' AND
  public.has_role(auth.uid(), 'admin')
);