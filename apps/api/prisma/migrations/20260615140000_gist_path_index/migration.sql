-- ltree alt-agac (<@) sicak yolu icin GiST index (guards migration'da soz verilen, eklenmeyen index).
-- memberships.path TEXT olarak tutulur; sorgu aninda path::ltree'ye cast edilir (ranks.service.ts).
-- Bu yuzden ifade (expression) index'i ((path::ltree)) tam olarak <@ sorgu operandina denk gelir.
-- Olmadan: her satis onayinda satici alt-agacini saymak O(n) seq scan.
CREATE INDEX IF NOT EXISTS memberships_path_gist ON memberships USING gist ((path::ltree));
