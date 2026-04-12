-- Adicionar coluna avatar_url
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Criar o bucket 'avatars'
INSERT INTO storage.buckets (id, name, public) 
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Garantir que as políticas de RLS estão setadas adequadamente ao bucket 'avatars' no storage.objects
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'Avatar images are publicly accessible.'
    ) THEN
        CREATE POLICY "Avatar images are publicly accessible." 
        ON storage.objects FOR SELECT 
        USING ( bucket_id = 'avatars' );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'Anyone authenticated can upload avatars.'
    ) THEN
        CREATE POLICY "Anyone authenticated can upload avatars." 
        ON storage.objects FOR INSERT 
        TO authenticated 
        WITH CHECK ( bucket_id = 'avatars' );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'Anyone authenticated can update their avatars.'
    ) THEN
        CREATE POLICY "Anyone authenticated can update their avatars." 
        ON storage.objects FOR UPDATE 
        TO authenticated 
        USING ( bucket_id = 'avatars' );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'Anyone authenticated can delete avatars.'
    ) THEN
        CREATE POLICY "Anyone authenticated can delete avatars." 
        ON storage.objects FOR DELETE 
        TO authenticated 
        USING ( bucket_id = 'avatars' );
    END IF;
END $$;
