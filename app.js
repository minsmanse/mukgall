require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const cron = require('node-cron');
const session = require('express-session');
const { OAuth2Client } = require('google-auth-library');
const db = require('./database');

const app = express();
const port = 3000;

// Google OAuth2 설정
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'YOUR_GOOGLE_CLIENT_ID';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'YOUR_GOOGLE_CLIENT_SECRET';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://mukgall.o-r.kr/api/admin/auth/google/callback';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';

const oauth2Client = new OAuth2Client(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
);

const corsOptions = {
    origin: 'http://mukgall.o-r.kr',
    credentials: true,
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

app.set('trust proxy', true);

// 세션 설정
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key-change-this',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000
    }
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ==================== 비밀번호 인증 미들웨어 ====================
app.use((req, res, next) => {
    if (req.path.startsWith('/api/public/') || req.path.startsWith('/api/admin/auth/')) {
        return next();
    }

    if (req.path.startsWith('/api/admin/')) {
        if (req.session && req.session.isAdmin) {
            return next();
        } else {
            return res.status(401).json({ 
                success: false, 
                message: '관리자 인증이 필요합니다' 
            });
        }
    }

    const auth = req.headers.authorization;

    if (!auth) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Protected Area"');
        return res.status(401).json({ 
            success: false, 
            message: '인증이 필요합니다' 
        });
    }

    const credentials = Buffer.from(auth.split(' ')[1], 'base64').toString();
    const [username, password] = credentials.split(':');

    if (password === 'smemda') {
        next();
    } else {
        res.setHeader('WWW-Authenticate', 'Basic realm="Protected Area"');
        res.status(401).json({ 
            success: false, 
            message: '잘못된 비밀번호입니다' 
        });
    }
});

app.use(express.static(path.join(__dirname, 'public')));

// ==================== 유틸리티 함수 ====================
function getClientIP(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        return forwarded.split(',')[0].trim();
    }
    
    if (req.ip) {
        let ip = req.ip;
        if (ip.startsWith('::ffff:')) {
            ip = ip.substring(7);
        }
        return ip;
    }
    
    return req.socket.remoteAddress || '127.0.0.1';
}

function maskIP(ip) {
    if (!ip) return '(?.?.?.?)';

    let ipv4 = ip;

    if (ipv4 === '::1') {
        ipv4 = '127.0.0.1';
    }

    if (ipv4.startsWith('::ffff:')) {
        ipv4 = ipv4.substring(7);
    }

    if (ipv4.includes('.')) {
        const parts = ipv4.split('.');
        if (parts.length >= 2) {
            return `${parts[0]}.${parts[1]}`;
        }
    }

    return '?.?.?.?';
}

// ==================== 데이터베이스 헬퍼 함수 ====================
const dbHelpers = {
    checkPost: (postId) => {
        return new Promise((resolve, reject) => {
            const sql = 'SELECT id FROM posts WHERE id = ? AND status = 1';
            db.db.get(sql, [postId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    },

    checkComment: (commentId, postId) => {
        return new Promise((resolve, reject) => {
            const sql = 'SELECT id FROM comments WHERE id = ? AND post_id = ? AND status = 1';
            db.db.get(sql, [commentId, postId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    },

    insertPost: (clientIP, author, title, content) => {
        return new Promise((resolve, reject) => {
            const sql = 'INSERT INTO posts (ip, author, title, content) VALUES (?, ?, ?, ?)';
            db.db.run(sql, [clientIP, author, title, content], function (err) {
                if (err) reject(err);
                else resolve({
                    id: this.lastID,
                    ip: clientIP,
                    author,
                    title,
                    content,
                    likes: 0,
                    dislikes: 0,
                    status: 1
                });
            });
        });
    },

    insertComment: (clientIP, postId, parentId, author, content) => {
        return new Promise((resolve, reject) => {
            const sql = 'INSERT INTO comments (ip, post_id, parent_id, author, content) VALUES (?, ?, ?, ?, ?)';
            db.db.run(sql, [clientIP, postId, parentId, author, content], function (err) {
                if (err) reject(err);
                else resolve({
                    id: this.lastID,
                    ip: clientIP,
                    post_id: postId,
                    parent_id: parentId,
                    author,
                    content,
                    status: 1
                });
            });
        });
    },

    getCurrentVote: (postId, clientIP) => {
        return new Promise((resolve, reject) => {
            const sql = 'SELECT type FROM votes WHERE post_id = ? AND ip = ? AND status = 1';
            db.db.get(sql, [postId, clientIP], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    },

    insertVote: (postId, ip, type) => {
        return new Promise((resolve, reject) => {
            const checkSql = 'SELECT id FROM votes WHERE post_id = ? AND ip = ? AND status = 0';
            db.db.get(checkSql, [postId, ip], (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }
                
                if (row) {
                    const updateSql = 'UPDATE votes SET type = ?, status = 1 WHERE post_id = ? AND ip = ?';
                    db.db.run(updateSql, [type, postId, ip], function (err) {
                        if (err) reject(err);
                        else resolve(row.id);
                    });
                } else {
                    const insertSql = 'INSERT INTO votes (post_id, ip, type) VALUES (?, ?, ?)';
                    db.db.run(insertSql, [postId, ip, type], function (err) {
                        if (err) reject(err);
                        else resolve(this.lastID);
                    });
                }
            });
        });
    },

    removeVote: (postId, ip) => {
        return new Promise((resolve, reject) => {
            const sql = 'UPDATE votes SET status = 0 WHERE post_id = ? AND ip = ? AND status = 1';
            db.db.run(sql, [postId, ip], function (err) {
                if (err) reject(err);
                else resolve(this.changes > 0);
            });
        });
    },

    updateVote: (postId, ip, newType) => {
        return new Promise((resolve, reject) => {
            const sql = 'UPDATE votes SET type = ? WHERE post_id = ? AND ip = ? AND status = 1';
            db.db.run(sql, [newType, postId, ip], function (err) {
                if (err) reject(err);
                else resolve(this.changes > 0);
            });
        });
    },

    updatePostVoteCount: (postId, type, change) => {
        return new Promise((resolve, reject) => {
            const column = type === 'like' ? 'likes' : 'dislikes';
            const sql = `UPDATE posts SET ${column} = ${column} + ? WHERE id = ?`;
            db.db.run(sql, [change, postId], function (err) {
                if (err) reject(err);
                else resolve(this.changes > 0);
            });
        });
    },

    getVoteCounts: (postId) => {
        return new Promise((resolve, reject) => {
            const sql = 'SELECT likes, dislikes FROM posts WHERE id = ?';
            db.db.get(sql, [postId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    },

    getPost: (postId) => {
        return new Promise((resolve, reject) => {
            const sql = 'SELECT id, ip, author, title, content, likes, dislikes, time, views, is_notice FROM posts WHERE id = ? AND status = 1';
            db.db.get(sql, [postId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    },

    getComments: (postId) => {
        return new Promise((resolve, reject) => {
            const sql = `
        SELECT id, ip, post_id, parent_id, author, content, time 
        FROM comments 
        WHERE post_id = ? AND status = 1 
        ORDER BY 
          CASE WHEN parent_id IS NULL THEN id ELSE parent_id END,
          CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END,
          id ASC
      `;
            db.db.all(sql, [postId], (err, rows) => {
                if (err) reject(err);
                else {
                    const maskedRows = rows.map(row => ({
                        ...row,
                        author_ip: maskIP(row.ip)
                    }));
                    resolve(maskedRows);
                }
            });
        });
    }
};

// ==================== 댓글 계층 구조 함수 ====================
function organizeComments(comments) {
    const commentMap = {};
    const rootComments = [];

    comments.forEach(comment => {
        comment.replies = [];
        commentMap[comment.id] = comment;
    });

    comments.forEach(comment => {
        if (comment.parent_id === null) {
            rootComments.push(comment);
        } else {
            const parent = commentMap[comment.parent_id];
            if (parent) {
                parent.replies.push(comment);
            }
        }
    });

    return rootComments;
}

// ==================== 관리자 인증 체크 미들웨어 ====================
function requireAdmin(req, res, next) {
    if (req.session && req.session.isAdmin) {
        return next();
    }
    return res.redirect('/api/admin/auth/google');
}

// ==================== 뷰 라우트 ====================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/board', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'board.html'));
});

app.get('/board/write', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'write.html'));
});

app.get('/board/gaenyeom', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'recommended.html'));
});

app.get('/notice', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'notice.html'));
});

app.get('/board/:id', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'post.html'));
});

app.get('/admin', requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ==================== Google OAuth2 인증 라우트 ====================

app.get('/api/admin/auth/google', (req, res) => {
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['profile', 'email']
    });
    res.redirect(authUrl);
});

app.get('/api/admin/auth/google/callback', async (req, res) => {
    const { code } = req.query;

    try {
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        const ticket = await oauth2Client.verifyIdToken({
            idToken: tokens.id_token,
            audience: GOOGLE_CLIENT_ID
        });

        const payload = ticket.getPayload();
        const email = payload.email;

        if (email === ADMIN_EMAIL) {
            req.session.isAdmin = true;
            req.session.adminEmail = email;
            req.session.adminName = payload.name;
            
            res.redirect('/admin');
        } else {
            res.status(403).send('관리자 권한이 없습니다.');
        }
    } catch (error) {
        console.error('OAuth2 callback error:', error);
        res.status(500).send('인증 오류가 발생했습니다.');
    }
});

app.get('/api/admin/auth/check', (req, res) => {
    if (req.session && req.session.isAdmin) {
        res.json({
            success: true,
            isAdmin: true,
            email: req.session.adminEmail,
            name: req.session.adminName
        });
    } else {
        res.json({
            success: true,
            isAdmin: false
        });
    }
});

app.post('/api/admin/auth/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            res.status(500).json({ success: false, message: '로그아웃 실패' });
        } else {
            res.json({ success: true, message: '로그아웃 성공' });
        }
    });
});

// ==================== 관리자 API 라우트 ====================

// 게시글 목록 조회 (관리자)
app.get('/api/admin/posts', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const status = req.query.status || 'active';
        const search = req.query.search || '';
        const offset = (page - 1) * limit;

        let statusCondition = 'status = 1';
        if (status === 'deleted') statusCondition = 'status = 0';
        else if (status === 'all') statusCondition = '1=1';

        let searchCondition = '';
        let params = [];
        if (search) {
            searchCondition = 'AND (title LIKE ? OR author LIKE ? OR content LIKE ?)';
            const searchPattern = `%${search}%`;
            params = [searchPattern, searchPattern, searchPattern];
        }

        const countSql = `SELECT COUNT(*) as total FROM posts WHERE ${statusCondition} ${searchCondition}`;
        const dataSql = `
            SELECT id, ip, author, title, content, likes, dislikes, views, time, is_notice, status
            FROM posts 
            WHERE ${statusCondition} ${searchCondition}
            ORDER BY id DESC 
            LIMIT ? OFFSET ?
        `;

        db.db.get(countSql, params, (err, countRow) => {
            if (err) {
                console.error('❌ 게시글 수 조회 오류:', err);
                return res.status(500).json({ success: false, message: '서버 내부 오류' });
            }

            const total = countRow.total;
            const totalPages = Math.ceil(total / limit);

            db.db.all(dataSql, [...params, limit, offset], (err, rows) => {
                if (err) {
                    console.error('❌ 게시글 목록 조회 오류:', err);
                    return res.status(500).json({ success: false, message: '서버 내부 오류' });
                }

                res.json({
                    success: true,
                    data: rows,
                    pagination: { page, limit, total, totalPages }
                });
            });
        });
    } catch (error) {
        console.error('❌ 게시글 목록 조회 오류:', error);
        res.status(500).json({ success: false, message: '서버 내부 오류' });
    }
});

// 댓글 목록 조회 (관리자)
app.get('/api/admin/comments', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const status = req.query.status || 'active';
        const search = req.query.search || '';
        const offset = (page - 1) * limit;

        let statusCondition = 'status = 1';
        if (status === 'deleted') statusCondition = 'status = 0';
        else if (status === 'all') statusCondition = '1=1';

        let searchCondition = '';
        let params = [];
        if (search) {
            searchCondition = 'AND (author LIKE ? OR content LIKE ?)';
            const searchPattern = `%${search}%`;
            params = [searchPattern, searchPattern];
        }

        const countSql = `SELECT COUNT(*) as total FROM comments WHERE ${statusCondition} ${searchCondition}`;
        const dataSql = `
            SELECT id, ip, post_id, parent_id, author, content, time, status
            FROM comments 
            WHERE ${statusCondition} ${searchCondition}
            ORDER BY id DESC 
            LIMIT ? OFFSET ?
        `;

        db.db.get(countSql, params, (err, countRow) => {
            if (err) {
                console.error('❌ 댓글 수 조회 오류:', err);
                return res.status(500).json({ success: false, message: '서버 내부 오류' });
            }

            const total = countRow.total;
            const totalPages = Math.ceil(total / limit);

            db.db.all(dataSql, [...params, limit, offset], (err, rows) => {
                if (err) {
                    console.error('❌ 댓글 목록 조회 오류:', err);
                    return res.status(500).json({ success: false, message: '서버 내부 오류' });
                }

                res.json({
                    success: true,
                    data: rows,
                    pagination: { page, limit, total, totalPages }
                });
            });
        });
    } catch (error) {
        console.error('❌ 댓글 목록 조회 오류:', error);
        res.status(500).json({ success: false, message: '서버 내부 오류' });
    }
});

// 통계 조회
app.get('/api/admin/stats', async (req, res) => {
    try {
        const queries = {
            totalPosts: 'SELECT COUNT(*) as count FROM posts',
            activePosts: 'SELECT COUNT(*) as count FROM posts WHERE status = 1',
            deletedPosts: 'SELECT COUNT(*) as count FROM posts WHERE status = 0',
            notices: 'SELECT COUNT(*) as count FROM posts WHERE is_notice = 1 AND status = 1',
            recommended: 'SELECT COUNT(*) as count FROM recommended_posts',
            totalComments: 'SELECT COUNT(*) as count FROM comments'
        };

        const stats = {};
        const keys = Object.keys(queries);
        let completed = 0;

        keys.forEach(key => {
            db.db.get(queries[key], (err, row) => {
                if (!err) stats[key] = row.count;
                completed++;
                
                if (completed === keys.length) {
                    res.json({ success: true, data: stats });
                }
            });
        });
    } catch (error) {
        console.error('❌ 통계 조회 오류:', error);
        res.status(500).json({ success: false, message: '서버 내부 오류' });
    }
});

// 게시글 복원
app.post('/api/admin/post/:id/restore', async (req, res) => {
    try {
        const postId = parseInt(req.params.id);

        if (!postId || postId < 1) {
            return res.status(400).json({
                success: false,
                message: '유효하지 않은 글 ID입니다.'
            });
        }

        const sql = 'UPDATE posts SET status = 1 WHERE id = ?';
        db.db.run(sql, [postId], function (err) {
            if (err) {
                console.error('❌ 게시글 복원 오류:', err);
                return res.status(500).json({
                    success: false,
                    message: '서버 내부 오류가 발생했습니다.'
                });
            }

            if (this.changes === 0) {
                return res.status(404).json({
                    success: false,
                    message: '존재하지 않는 글입니다.'
                });
            }

            res.json({
                success: true,
                message: '게시글이 복원되었습니다.',
                data: { post_id: postId }
            });
        });
    } catch (error) {
        console.error('❌ 게시글 복원 오류:', error);
        res.status(500).json({
            success: false,
            message: '서버 내부 오류가 발생했습니다.'
        });
    }
});

// 댓글 복원
app.post('/api/admin/comment/:id/restore', async (req, res) => {
    try {
        const commentId = parseInt(req.params.id);

        if (!commentId || commentId < 1) {
            return res.status(400).json({
                success: false,
                message: '유효하지 않은 댓글 ID입니다.'
            });
        }

        const sql = 'UPDATE comments SET status = 1 WHERE id = ?';
        db.db.run(sql, [commentId], function (err) {
            if (err) {
                console.error('❌ 댓글 복원 오류:', err);
                return res.status(500).json({
                    success: false,
                    message: '서버 내부 오류가 발생했습니다.'
                });
            }

            if (this.changes === 0) {
                return res.status(404).json({
                    success: false,
                    message: '존재하지 않는 댓글입니다.'
                });
            }

            res.json({
                success: true,
                message: '댓글이 복원되었습니다.',
                data: { comment_id: commentId }
            });
        });
    } catch (error) {
        console.error('❌ 댓글 복원 오류:', error);
        res.status(500).json({
            success: false,
            message: '서버 내부 오류가 발생했습니다.'
        });
    }
});

app.post('/api/admin/notice/:id', async (req, res) => {
    try {
        const postId = parseInt(req.params.id);
        const { is_notice } = req.body;

        if (!postId || postId < 1) {
            return res.status(400).json({
                success: false,
                message: '유효하지 않은 글 ID입니다.'
            });
        }

        const sql = 'UPDATE posts SET is_notice = ? WHERE id = ? AND status = 1';
        db.db.run(sql, [is_notice ? 1 : 0, postId], function (err) {
            if (err) {
                console.error('❌ 공지 설정 오류:', err);
                return res.status(500).json({
                    success: false,
                    message: '서버 내부 오류가 발생했습니다.'
                });
            }

            if (this.changes === 0) {
                return res.status(404).json({
                    success: false,
                    message: '존재하지 않는 글입니다.'
                });
            }

            res.json({
                success: true,
                message: is_notice ? '공지로 등록되었습니다.' : '공지가 해제되었습니다.',
                data: { post_id: postId, is_notice: is_notice ? 1 : 0 }
            });
        });
    } catch (error) {
        console.error('❌ 공지 설정 오류:', error);
        res.status(500).json({
            success: false,
            message: '서버 내부 오류가 발생했습니다.'
        });
    }
});

// 게시글 삭제 (soft delete)
app.delete('/api/admin/post/:id', async (req, res) => {
    try {
        const postId = parseInt(req.params.id);
        const hard = req.query.hard === 'true';

        if (!postId || postId < 1) {
            return res.status(400).json({
                success: false,
                message: '유효하지 않은 글 ID입니다.'
            });
        }

        if (hard) {
            // 하드 삭제 - DB에서 완전히 제거
            const sql = 'DELETE FROM posts WHERE id = ?';
            db.db.run(sql, [postId], function (err) {
                if (err) {
                    console.error('❌ 게시글 영구삭제 오류:', err);
                    return res.status(500).json({
                        success: false,
                        message: '서버 내부 오류가 발생했습니다.'
                    });
                }

                if (this.changes === 0) {
                    return res.status(404).json({
                        success: false,
                        message: '존재하지 않는 글입니다.'
                    });
                }

                res.json({
                    success: true,
                    message: '게시글이 영구 삭제되었습니다.',
                    data: { post_id: postId }
                });
            });
        } else {
            // 소프트 삭제 - status만 변경
            const sql = 'UPDATE posts SET status = 0 WHERE id = ?';
            db.db.run(sql, [postId], function (err) {
                if (err) {
                    console.error('❌ 게시글 삭제 오류:', err);
                    return res.status(500).json({
                        success: false,
                        message: '서버 내부 오류가 발생했습니다.'
                    });
                }

                if (this.changes === 0) {
                    return res.status(404).json({
                        success: false,
                        message: '존재하지 않는 글입니다.'
                    });
                }

                res.json({
                    success: true,
                    message: '게시글이 삭제되었습니다.',
                    data: { post_id: postId }
                });
            });
        }
    } catch (error) {
        console.error('❌ 게시글 삭제 오류:', error);
        res.status(500).json({
            success: false,
            message: '서버 내부 오류가 발생했습니다.'
        });
    }
});

// 댓글 삭제 (soft delete)
app.delete('/api/admin/comment/:id', async (req, res) => {
    try {
        const commentId = parseInt(req.params.id);
        const hard = req.query.hard === 'true';

        if (!commentId || commentId < 1) {
            return res.status(400).json({
                success: false,
                message: '유효하지 않은 댓글 ID입니다.'
            });
        }

        if (hard) {
            // 하드 삭제 - DB에서 완전히 제거
            const sql = 'DELETE FROM comments WHERE id = ?';
            db.db.run(sql, [commentId], function (err) {
                if (err) {
                    console.error('❌ 댓글 영구삭제 오류:', err);
                    return res.status(500).json({
                        success: false,
                        message: '서버 내부 오류가 발생했습니다.'
                    });
                }

                if (this.changes === 0) {
                    return res.status(404).json({
                        success: false,
                        message: '존재하지 않는 댓글입니다.'
                    });
                }

                res.json({
                    success: true,
                    message: '댓글이 영구 삭제되었습니다.',
                    data: { comment_id: commentId }
                });
            });
        } else {
            // 소프트 삭제 - status만 변경
            const sql = 'UPDATE comments SET status = 0 WHERE id = ?';
            db.db.run(sql, [commentId], function (err) {
                if (err) {
                    console.error('❌ 댓글 삭제 오류:', err);
                    return res.status(500).json({
                        success: false,
                        message: '서버 내부 오류가 발생했습니다.'
                    });
                }

                if (this.changes === 0) {
                    return res.status(404).json({
                        success: false,
                        message: '존재하지 않는 댓글입니다.'
                    });
                }

                res.json({
                    success: true,
                    message: '댓글이 삭제되었습니다.',
                    data: { comment_id: commentId }
                });
            });
        }
    } catch (error) {
        console.error('❌ 댓글 삭제 오류:', error);
        res.status(500).json({
            success: false,
            message: '서버 내부 오류가 발생했습니다.'
        });
    }
});

// ==================== API 라우트 ====================

app.get('/api/public/recommended-posts', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 15;
        const clientIP = getClientIP(req);

        const posts = await db.getRecommendedPosts(page, limit, clientIP);
        const maskedRows = posts.map(row => ({
            ...row,
            author_ip: maskIP(row.ip)
        }));

        res.json({
            success: true,
            data: maskedRows,
            pagination: { page, limit, hasNext: maskedRows.length === limit }
        });
    } catch (error) {
        console.error('❌ 개념글 목록 조회 오류:', error);
        res.status(500).json({ success: false, message: '서버 내부 오류' });
    }
});

app.get('/api/public/posts', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 15;
        const clientIP = getClientIP(req);

        const posts = await db.getBoardPosts(page, limit, clientIP);
        const maskedRows = posts.map(row => ({
            ...row,
            author_ip: maskIP(row.ip)
        }));

        res.json({
            success: true,
            data: maskedRows,
            pagination: { page, limit, hasNext: maskedRows.length === limit }
        });
    } catch (error) {
        console.error('❌ 글 목록 조회 오류:', error);
        res.status(500).json({ success: false, message: '서버 내부 오류' });
    }
});

app.get('/api/public/post/:id', async (req, res) => {
    try {
        const postId = parseInt(req.params.id);
        if (!postId || postId < 1) {
            return res.status(400).json({ success: false, message: '유효하지 않은 글 ID' });
        }

        await db.incrementPostViews(postId);
        const clientIP = getClientIP(req);

        const [post, currentVote] = await Promise.all([
            dbHelpers.getPost(postId),
            dbHelpers.getCurrentVote(postId, clientIP)
        ]);

        if (!post) {
            return res.status(404).json({ success: false, message: '글을 찾을 수 없습니다.' });
        }

        const postWithVotes = {
            ...post,
            author_ip: maskIP(post.ip),
            user_vote: currentVote ? currentVote.type : null
        };

        res.json({ success: true, data: postWithVotes });
    } catch (error) {
        console.error('❌ 글 조회 오류:', error);
        res.status(500).json({ success: false, message: '서버 내부 오류' });
    }
});

app.post('/api/public/post/', async (req, res) => {
    try {
        const { author, title, content } = req.body;

        if (!author || !title || !content) {
            return res.status(400).json({
                success: false,
                message: '작성자, 제목, 내용을 모두 입력해주세요.'
            });
        }

        const clientIP = getClientIP(req);
        const newPost = await dbHelpers.insertPost(clientIP, author, title, content);

        res.status(201).json({
            success: true,
            message: '글이 성공적으로 작성되었습니다.',
            data: newPost
        });
    } catch (error) {
        console.error('❌ 글쓰기 오류:', error);
        res.status(500).json({
            success: false,
            message: '서버 내부 오류가 발생했습니다.'
        });
    }
});

app.get('/api/public/comments/:post_id', async (req, res) => {
    try {
        const postId = parseInt(req.params.post_id);

        if (!postId || postId < 1) {
            return res.status(400).json({
                success: false,
                message: '유효하지 않은 글 ID입니다.'
            });
        }

        const postExists = await dbHelpers.checkPost(postId);
        if (!postExists) {
            return res.status(404).json({
                success: false,
                message: '존재하지 않는 글입니다.'
            });
        }

        const comments = await dbHelpers.getComments(postId);
        const organizedComments = organizeComments(comments);

        res.json({
            success: true,
            data: {
                post_id: postId,
                comments: organizedComments,
                total_count: comments.length
            }
        });
    } catch (error) {
        console.error('❌ 댓글 목록 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '서버 내부 오류가 발생했습니다.'
        });
    }
});

app.post('/api/public/comment/', async (req, res) => {
    try {
        const { post_id, parent_id, author, content } = req.body;

        if (!post_id || !author || !content) {
            return res.status(400).json({
                success: false,
                message: '글 ID, 작성자, 내용을 모두 입력해주세요.'
            });
        }

        const postId = parseInt(post_id);
        if (!postId || postId < 1) {
            return res.status(400).json({
                success: false,
                message: '유효하지 않은 글 ID입니다.'
            });
        }

        let parentId = null;
        if (parent_id) {
            parentId = parseInt(parent_id);
            if (!parentId || parentId < 1) {
                return res.status(400).json({
                    success: false,
                    message: '유효하지 않은 부모 댓글 ID입니다.'
                });
            }
        }

        const postExists = await dbHelpers.checkPost(postId);
        if (!postExists) {
            return res.status(404).json({
                success: false,
                message: '존재하지 않는 글입니다.'
            });
        }

        if (parentId) {
            const parentExists = await dbHelpers.checkComment(parentId, postId);
            if (!parentExists) {
                return res.status(404).json({
                    success: false,
                    message: '존재하지 않는 부모 댓글입니다.'
                });
            }
        }

        const clientIP = getClientIP(req);
        const newComment = await dbHelpers.insertComment(clientIP, postId, parentId, author, content);

        res.status(201).json({
            success: true,
            message: '댓글이 성공적으로 작성되었습니다.',
            data: newComment
        });
    } catch (error) {
        console.error('❌ 댓글 작성 오류:', error);
        res.status(500).json({
            success: false,
            message: '서버 내부 오류가 발생했습니다.'
        });
    }
});

app.post('/api/public/vote/', async (req, res) => {
    try {
        const { post_id, type } = req.body;

        if (!post_id || !type) {
            return res.status(400).json({
                success: false,
                message: '글 ID와 투표 타입을 모두 입력해주세요.'
            });
        }

        const postId = parseInt(post_id);
        if (!postId || postId < 1) {
            return res.status(400).json({
                success: false,
                message: '유효하지 않은 글 ID입니다.'
            });
        }

        if (type !== 'like' && type !== 'dislike') {
            return res.status(400).json({
                success: false,
                message: '투표 타입은 like 또는 dislike만 가능합니다.'
            });
        }

        const postExists = await dbHelpers.checkPost(postId);
        if (!postExists) {
            return res.status(404).json({
                success: false,
                message: '존재하지 않는 글입니다.'
            });
        }

        const clientIP = getClientIP(req);
        const currentVote = await dbHelpers.getCurrentVote(postId, clientIP);

        let action = '';
        let message = '';

        if (!currentVote) {
            await dbHelpers.insertVote(postId, clientIP, type);
            await dbHelpers.updatePostVoteCount(postId, type, 1);
            action = 'added';
            message = type === 'like' ? '좋아요를 눌렀습니다.' : '싫어요를 눌렀습니다.';
        } else if (currentVote.type === type) {
            await dbHelpers.removeVote(postId, clientIP);
            await dbHelpers.updatePostVoteCount(postId, type, -1);
            action = 'removed';
            message = type === 'like' ? '좋아요를 취소했습니다.' : '싫어요를 취소했습니다.';
        } else {
            await dbHelpers.updateVote(postId, clientIP, type);
            await dbHelpers.updatePostVoteCount(postId, currentVote.type, -1);
            await dbHelpers.updatePostVoteCount(postId, type, 1);
            action = 'changed';
            message = type === 'like' ? '싫어요에서 좋아요로 변경했습니다.' : '좋아요에서 싫어요로 변경했습니다.';
        }

        const voteCounts = await dbHelpers.getVoteCounts(postId);

        res.json({
            success: true,
            message: message,
            data: {
                post_id: postId,
                action: action,
                current_vote: action === 'removed' ? null : type,
                likes: voteCounts.likes,
                dislikes: voteCounts.dislikes
            }
        });
    } catch (error) {
        console.error('❌ 투표 처리 오류:', error);
        res.status(500).json({
            success: false,
            message: '서버 내부 오류가 발생했습니다.'
        });
    }
});

// ==================== 404 처리 ====================
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// ==================== 서버 시작 ====================
async function startServer() {
    try {
        await db.connect();
        await db.initTables();

        app.listen(port, () => {
            console.log(`🚀 Server is running on http://localhost:${port}`);
            console.log(`🔒 Password protection enabled: Use password "smemda" to access`);
            console.log(`👤 Admin email: ${ADMIN_EMAIL}`);

            cron.schedule('*/1 * * * *', () => {
                console.log('⏰ Running a task every minute to check for recommended posts.');
                db.promotePostsToRecommended();
            });
        });
    } catch (error) {
        console.error('Failed to start server:', error);
    }
}

startServer();