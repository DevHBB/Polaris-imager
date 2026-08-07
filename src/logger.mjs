// Access-log writer with built-in size-based rotation. Self-contained (no deps),
// so it works the same in Docker, systemd, or a bare process. When no log file
// is configured, lines go to stdout (console.log) and rotation is a no-op —
// handy if you'd rather let the platform (journald/Docker) capture stdout.
//
// Rotation scheme: when the active file passes maxBytes it becomes <file>.1,
// the previous <file>.1 becomes <file>.2, … up to maxFiles; the oldest is
// dropped. Writes during a rotation are buffered and flushed afterwards.

import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'fs';
import { dirname } from 'path';

class RotatingLogger {
    #file;
    #maxBytes;
    #maxFiles;
    #stream = null;
    #bytes = 0;
    #rotating = false;
    #queue = [];

    constructor(file, maxBytes, maxFiles) {
        this.#file = file;
        this.#maxBytes = maxBytes > 0 ? maxBytes : Infinity;
        this.#maxFiles = Math.max(1, maxFiles);

        mkdirSync(dirname(file), { recursive: true });

        this.#bytes = existsSync(file) ? statSync(file).size : 0;
        this.#open();
    }

    #open() {
        this.#stream = createWriteStream(this.#file, { flags: 'a' });
        this.#stream.on('error', (error) => {
            // Never let a logging failure take down the service.
            console.error('[avatar-imaging] access log write failed:', error.message);
        });
    }

    write(line) {
        const data = `${line}\n`;

        if (this.#rotating) {
            this.#queue.push(data);

            return;
        }

        this.#stream.write(data);
        this.#bytes += Buffer.byteLength(data);

        if (this.#bytes >= this.#maxBytes) this.#rotate();
    }

    #rotate() {
        this.#rotating = true;

        this.#stream.end(() => {
            try {
                const oldest = `${this.#file}.${this.#maxFiles}`;

                if (existsSync(oldest)) unlinkSync(oldest);

                for (let i = this.#maxFiles - 1; i >= 1; i--) {
                    const from = `${this.#file}.${i}`;

                    if (existsSync(from)) renameSync(from, `${this.#file}.${i + 1}`);
                }

                renameSync(this.#file, `${this.#file}.1`);
            } catch (error) {
                console.error('[avatar-imaging] access log rotation failed:', error.message);
            }

            this.#bytes = 0;
            this.#open();
            this.#rotating = false;

            const pending = this.#queue;

            this.#queue = [];

            for (const data of pending) {
                this.#stream.write(data);
                this.#bytes += Buffer.byteLength(data);
            }

            if (this.#bytes >= this.#maxBytes) this.#rotate();
        });
    }

    close() {
        try {
            this.#stream?.end();
        } catch {
            // ignore
        }
    }
}

// Returns { write(line), close() }. Writes to a rotating file when logFile is
// set, otherwise to stdout.
export const createAccessLogger = ({ logFile, logMaxBytes, logMaxFiles }) => {
    if (!logFile) {
        return { write: (line) => console.log(line), close: () => {} };
    }

    try {
        const logger = new RotatingLogger(logFile, logMaxBytes, logMaxFiles);

        return { write: (line) => logger.write(line), close: () => logger.close() };
    } catch (error) {
        console.error(`[avatar-imaging] could not open log file "${logFile}" (${error.message}); logging to stdout.`);

        return { write: (line) => console.log(line), close: () => {} };
    }
};
