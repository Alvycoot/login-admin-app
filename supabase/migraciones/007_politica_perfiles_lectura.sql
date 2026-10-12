CREATE POLICY "Cada usuario lee su propio perfil"
ON perfiles
FOR SELECT
TO authenticated
USING (id = auth.uid());