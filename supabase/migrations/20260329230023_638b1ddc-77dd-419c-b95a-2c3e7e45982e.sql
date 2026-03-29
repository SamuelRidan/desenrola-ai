CREATE POLICY "Admins can update statements storage"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'statements' AND
  public.has_role(auth.uid(), 'admin')
)
WITH CHECK (
  bucket_id = 'statements' AND
  public.has_role(auth.uid(), 'admin')
);