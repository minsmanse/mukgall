const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class Database {
  constructor() {
    this.db = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const dbPath = path.join(__dirname, 'mukgall.db');
      this.db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
          console.error('⚠️ Cannot Connect to DB:', err.message);
          reject(err);
        } else {
          console.log('✅ Connected to the DB.');
          resolve();
        }
      });
    });
  }

  initTables() {
    return new Promise((resolve, reject) => {
      let tablesCreated = 0;
      const totalTables = 5; // 4개 테이블 + 1개 컬럼 추가
      
      const checkComplete = () => {
        tablesCreated++;
        if (tablesCreated === totalTables) {
          resolve();
        }
      };

      this.db.serialize(() => {
        // Posts table
        this.db.run(`CREATE TABLE IF NOT EXISTS posts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ip TEXT NOT NULL,
          time DATETIME DEFAULT CURRENT_TIMESTAMP,
          author TEXT NOT NULL,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          likes INTEGER DEFAULT 0,
          dislikes INTEGER DEFAULT 0,
          views INTEGER DEFAULT 0,
          is_notice INTEGER DEFAULT 0,
          status INTEGER DEFAULT 1
        )`, (err) => {
          if (err) {
            console.error('⚠️ Cannot Generate Posts Table:', err.message);
            reject(err);
          } else {
            console.log('✅ Posts Table is Ready.');
            checkComplete();
          }
        });

        // 기존 테이블에 is_notice 컬럼 추가 (마이그레이션)
        this.db.run(`ALTER TABLE posts ADD COLUMN is_notice INTEGER DEFAULT 0`, (err) => {
          if (err && !err.message.includes('duplicate column')) {
            console.error('⚠️ Cannot add is_notice column:', err.message);
          } else {
            console.log('✅ is_notice column checked/added.');
          }
          checkComplete();
        });

        // Votes table
        this.db.run(`CREATE TABLE IF NOT EXISTS votes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ip TEXT NOT NULL,
          time DATETIME DEFAULT CURRENT_TIMESTAMP,
          post_id INTEGER NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('like', 'dislike')),
          status INTEGER DEFAULT 1,
          UNIQUE(post_id, ip)
        )`, (err) => {
          if (err) {
            console.error('⚠️ Cannot Generate Votes Table:', err.message);
            reject(err);
          } else {
            console.log('✅ Votes Table is Ready.');
            checkComplete();
          }
        });

        // Comments table
        this.db.run(`CREATE TABLE IF NOT EXISTS comments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ip TEXT NOT NULL,
          time DATETIME DEFAULT CURRENT_TIMESTAMP,
          post_id INTEGER NOT NULL,
          parent_id INTEGER DEFAULT NULL,
          author TEXT NOT NULL,
          content TEXT NOT NULL,
          status INTEGER DEFAULT 1
        )`, (err) => {
          if (err) {
            console.error('⚠️ Cannot Generate Comments Table:', err.message);
            reject(err);
          } else {
            console.log('✅ Comments Table is Ready.');
            checkComplete();
          }
        });

        // Recommended posts table
        this.db.run(`CREATE TABLE IF NOT EXISTS recommended_posts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          post_id INTEGER NOT NULL UNIQUE,
          promoted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE
        )`, (err) => {
          if (err) {
            console.error('⚠️ Cannot Generate Recommended Posts Table:', err.message);
            reject(err);
          } else {
            console.log('✅ Recommended Posts Table is Ready.');
            checkComplete();
          }
        });
      });
    });
  }

  close() {
    return new Promise((resolve, reject) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) {
            console.error('⚠️ Error closing database:', err.message);
            reject(err);
          } else {
            console.log('✅ Database connection closed.');
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }

  incrementPostViews(postId) {
    return new Promise((resolve, reject) => {
      const sql = `UPDATE posts SET views = views + 1 WHERE id = ?`;
      this.db.run(sql, [postId], function (err) {
        if (err) {
          console.error(`⚠️ Cannot increment view for post ${postId}:`, err.message);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async promotePostsToRecommended() {
    const findSql = `
      SELECT id FROM posts
      WHERE 
        time >= datetime('now', '-24 hours')
        AND (views >= 10 OR likes >= 2)
        AND is_notice = 0
        AND id NOT IN (SELECT post_id FROM recommended_posts)
    `;
    
    this.db.all(findSql, [], (err, rows) => {
      if (err) {
        console.error('⚠️ Error finding posts to promote:', err.message);
        return;
      }

      if (rows.length > 0) {
        const insertSql = `INSERT OR IGNORE INTO recommended_posts (post_id) VALUES (?)`;
        const stmt = this.db.prepare(insertSql);
        let promotedCount = 0;
        rows.forEach(row => {
          stmt.run(row.id, function(err) {
            if (!err && this.changes > 0) {
              promotedCount++;
            }
          });
        });
        stmt.finalize((err) => {
          if (!err && promotedCount > 0) {
            console.log(`✅ Promoted ${promotedCount} new post(s) to recommended.`);
          }
        });
      }
    });
  }

  getBoardPosts(page, limit, clientIP) {
    return new Promise((resolve, reject) => {
      const offset = (page - 1) * limit;
      const sql = `
          SELECT 
              p.id, p.ip, p.author, p.title, p.likes, p.dislikes, p.time, p.views,
              p.is_notice,
              v.type as user_vote,
              rp.promoted_at,
              COUNT(c.id) as comment_count
          FROM posts p
          LEFT JOIN votes v ON p.id = v.post_id AND v.ip = ? AND v.status = 1
          LEFT JOIN recommended_posts rp ON p.id = rp.post_id
          LEFT JOIN comments c ON p.id = c.post_id AND c.status = 1
          WHERE p.status = 1
          GROUP BY p.id
          ORDER BY p.is_notice DESC, p.id DESC 
          LIMIT ? OFFSET ?
      `;
      this.db.all(sql, [clientIP, limit, offset], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
      });
    });
  }

  getRecommendedPosts(page, limit, clientIP) {
    return new Promise((resolve, reject) => {
        const offset = (page - 1) * limit;
        const sql = `
            SELECT 
                p.id, p.ip, p.author, p.title, p.likes, p.dislikes, p.time, p.views,
                p.is_notice,
                v.type as user_vote,
                rp.promoted_at,
                COUNT(c.id) as comment_count
            FROM posts p
            INNER JOIN recommended_posts rp ON p.id = rp.post_id
            LEFT JOIN votes v ON p.id = v.post_id AND v.ip = ? AND v.status = 1
            LEFT JOIN comments c ON p.id = c.post_id AND c.status = 1
            WHERE p.status = 1
            GROUP BY p.id
            ORDER BY rp.id DESC 
            LIMIT ? OFFSET ?
        `;
        this.db.all(sql, [clientIP, limit, offset], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
  }
}

module.exports = new Database();