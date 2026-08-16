// ---------------------------------------------------------------------------
// [EN] db.mjs — optional read-only MySQL/MariaDB access, used only by the
//      generator panel to turn a username into a figure (and to search
//      usernames). It is completely optional: with no DB settings in .env the
//      module never connects and the panel simply hides the search field.
//      Only SELECT is ever issued, so a read-only MySQL user is enough.
//
// [FR] db.mjs — accès MySQL/MariaDB optionnel en lecture seule, utilisé
//      uniquement par le panel du générateur pour transformer un pseudo en
//      figure (et pour rechercher des pseudos). C'est totalement optionnel :
//      sans réglages DB dans le .env, le module ne se connecte jamais et le
//      panel masque simplement le champ de recherche.
//      Seuls des SELECT sont exécutés : un utilisateur MySQL en lecture seule
//      suffit.
// ---------------------------------------------------------------------------

// [EN] Table and column names cannot be bound as SQL parameters, so they are
//      validated against a strict pattern and never interpolated raw.
// [FR] Les noms de table et de colonnes ne peuvent pas être passés en
//      paramètres SQL : ils sont donc validés par un motif strict et jamais
//      interpolés bruts.
const IDENT_RE = /^[A-Za-z0-9_]+$/;

const ident = (name, fallback) => (IDENT_RE.test(name || '') ? name : fallback);

let pool = null;          // [EN] lazy connection pool / [FR] pool de connexions paresseux
let poolFailed = false;   // [EN] don't retry a missing driver / [FR] ne pas réessayer si le pilote manque

/**
 * [EN] Open (once) the connection pool. Returns null when the DB is not
 *      configured or when the mysql2 driver is missing.
 * [FR] Ouvre (une seule fois) le pool de connexions. Renvoie null si la base
 *      n'est pas configurée ou si le pilote mysql2 est absent.
 */
const getPool = async (db) => {
    if (!db.enabled || poolFailed) return null;
    if (pool) return pool;

    try {
        // [EN] Imported dynamically so the service still boots if mysql2 was not
        //      installed (e.g. an old node_modules).
        // [FR] Importé dynamiquement pour que le service démarre quand même si
        //      mysql2 n'a pas été installé (ex. un node_modules ancien).
        const mysql = await import('mysql2/promise');

        pool = mysql.createPool({
            host: db.host,
            port: db.port,
            user: db.user,
            password: db.password,
            database: db.database,
            waitForConnections: true,
            connectionLimit: 4,
            connectTimeout: db.timeoutMs,
            charset: 'utf8mb4_general_ci'
        });

        return pool;
    } catch (error) {
        poolFailed = true;

        console.error('[pixinode] MySQL unavailable:', error?.message || error);
        console.error('[pixinode] Run `npm install` (the mysql2 driver is required for the username search).');

        return null;
    }
};

/**
 * [EN] Exact username -> { username, figure }, or null when unknown.
 * [FR] Pseudo exact -> { username, figure }, ou null si inconnu.
 */
export const findUserByName = async (db, username) => {
    const connection = await getPool(db);

    if (!connection) return null;

    const table = ident(db.table, 'users');
    const nameCol = ident(db.usernameColumn, 'username');
    const lookCol = ident(db.lookColumn, 'look');

    const [rows] = await connection.execute(
        `SELECT \`${ nameCol }\` AS username, \`${ lookCol }\` AS figure FROM \`${ table }\` WHERE \`${ nameCol }\` = ? LIMIT 1`,
        [username]
    );

    return rows?.[0] || null;
};

/**
 * [EN] Prefix search for the panel's suggestion list. Capped server-side so a
 *      short query can never dump the whole user table.
 * [FR] Recherche par préfixe pour la liste de suggestions du panel. Plafonnée
 *      côté serveur : une requête courte ne peut jamais vider toute la table
 *      des utilisateurs.
 */
export const searchUsers = async (db, query, limit = 8) => {
    const connection = await getPool(db);

    if (!connection) return [];

    const table = ident(db.table, 'users');
    const nameCol = ident(db.usernameColumn, 'username');
    const lookCol = ident(db.lookColumn, 'look');

    // [EN] Escape the LIKE wildcards in the user's input so "%" is literal.
    // [FR] Échappe les jokers LIKE dans la saisie pour que « % » reste littéral.
    const needle = `${ query.replace(/[\\%_]/g, (c) => `\\${ c }`) }%`;
    const size = Math.min(Math.max(parseInt(limit, 10) || 8, 1), 20);

    const [rows] = await connection.execute(
        `SELECT \`${ nameCol }\` AS username, \`${ lookCol }\` AS figure FROM \`${ table }\` ` +
        `WHERE \`${ nameCol }\` LIKE ? ORDER BY \`${ nameCol }\` ASC LIMIT ${ size }`,
        [needle]
    );

    return rows || [];
};

/**
 * [EN] Fetch the credentials of one account, for auth mode 'hotel' only. This is
 *      the ONLY query that ever touches the password and rank columns.
 * [FR] Récupère les identifiants d'un compte, pour le mode d'authentification
 *      'hotel' uniquement. C'est la SEULE requête qui touche un jour aux colonnes
 *      mot de passe et rang.
 */
export const findAccountForLogin = async (db, username) => {
    const connection = await getPool(db);

    if (!connection) return null;

    const table = ident(db.table, 'users');
    const nameCol = ident(db.usernameColumn, 'username');
    const passCol = ident(db.passwordColumn, 'password');
    const rankCol = ident(db.rankColumn, 'rank');

    const [rows] = await connection.execute(
        `SELECT \`${ nameCol }\` AS username, \`${ passCol }\` AS password, \`${ rankCol }\` AS rank ` +
        `FROM \`${ table }\` WHERE \`${ nameCol }\` = ? LIMIT 1`,
        [username]
    );

    return rows?.[0] || null;
};

/**
 * [EN] Startup check: report whether the credentials and table actually work,
 *      instead of failing silently on the first search.
 * [FR] Vérification au démarrage : signale si les identifiants et la table
 *      fonctionnent vraiment, au lieu d'échouer silencieusement à la première
 *      recherche.
 *
 * @param {object}  db
 * @param {boolean} withAuthColumns [EN] Also probe the password/rank columns
 *                                       (auth mode 'hotel').
 *                                  [FR] Sonde aussi les colonnes mot de passe /
 *                                       rang (mode d'authentification 'hotel').
 */
export const checkDatabase = async (db, withAuthColumns = false) => {
    if (!db.enabled) return { ok: false, skipped: true };

    try {
        const connection = await getPool(db);

        if (!connection) return { ok: false, error: 'driver mysql2 absent' };

        const table = ident(db.table, 'users');
        const nameCol = ident(db.usernameColumn, 'username');
        const lookCol = ident(db.lookColumn, 'look');

        await connection.execute(`SELECT \`${ nameCol }\`, \`${ lookCol }\` FROM \`${ table }\` LIMIT 1`);

        if (withAuthColumns) {
            const passCol = ident(db.passwordColumn, 'password');
            const rankCol = ident(db.rankColumn, 'rank');

            await connection.execute(`SELECT \`${ passCol }\`, \`${ rankCol }\` FROM \`${ table }\` LIMIT 1`);
        }

        return { ok: true };
    } catch (error) {
        return { ok: false, error: error?.message || String(error) };
    }
};

export const closeDatabase = async () => {
    if (pool) {
        try {
            await pool.end();
        } catch {
            // [EN] Shutdown path — nothing useful to do. [FR] Arrêt — rien d'utile à faire.
        }

        pool = null;
    }
};
