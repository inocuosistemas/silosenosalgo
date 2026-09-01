-- Restablecer la contraseña, por enlace de un solo uso.
--
-- No había forma de cambiar una contraseña, ni para quien la olvida ni para
-- quien administra: sin recuperación por correo, una contraseña mal tecleada al
-- darse de alta dejaba a esa persona fuera de su cuenta recién creada, y la
-- única salida era borrarla y volver a invitarla. Pasó de verdad.
--
-- El enlace lo genera un administrador y la contraseña nueva la elige SU DUEÑO.
-- Es deliberado: si la pusiera el administrador, tendría que hacérsela llegar
-- por algún chat —donde queda escrita para siempre— y además sabría la
-- contraseña de otra persona, que es justo lo que no debe pasar. Así el
-- administrador reparte una llave de un solo uso y no llega a saber nada.
--
-- Mismo diseño que `invitations`, que ya resolvió este problema para el alta:
-- código inadivinable, caducidad, y `used_at` como marca de consumido. Los
-- códigos usados NO se borran: dejan ver que alguien restableció y cuándo.

PRAGMA foreign_keys = ON;

CREATE TABLE password_resets (
  code       TEXT PRIMARY KEY,          -- genId(12), viaja como ?reset=<code>
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL,             -- quién lo generó (id de administrador)
  created_at INTEGER NOT NULL,          -- epoch ms
  expires_at INTEGER NOT NULL,          -- epoch ms; corto a propósito (24 h)
  used_at    INTEGER                    -- NULL = sin usar; un solo uso
);
CREATE INDEX idx_password_resets_user ON password_resets(user_id);
