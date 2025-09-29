const express = require('express');
const path = require('path');
const cors = require('cors');
const cron = require('node-cron');
const db = require('./database');

const app = express();
const port = 3000;

// ==================== 미들웨어 설정 ====================
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ==================== 비밀번호 인증 미들웨어 ====================
app.use((req, res, next) => {
  const auth = req.headers.authorization;
  
  if (!auth) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Protected Area"');
    return res.status(401).send('인증이 필요합니다');
  }
  
  // "Basic " 부분을 제거하고 base64 디코딩
  const credentials = Buffer.from(auth.split(' ')[1], 'base64').toString();
  const [username, password] = credentials.split(':');
  
  // 비밀번호가 "smemda"인지 확인 (사용자명은 무엇이든 가능)
  if (password === 'smemda') {
    next();
  } else {
    res.setHeader('WWW-Authenticate', 'Basic realm="Protected Area"');
    res.status(401).send('잘못된 비밀번호입니다');
  }
});

app.use(express.static(path.join(__dirname, 'public')));

// ==================== 유틸리티 함수 ====================
function getClientIP(req) {
  return req.headers['x-forwarded-for'] || 
         req.connection.remoteAddress || 
         req.socket.remoteAddress ||
         (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
         '127.0.0.1';
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
  // 게시글 확인
  checkPost: (postId) => {
    return new Promise((resolve, reject) => {
      const sql = 'SELECT id FROM posts WHERE id = ? AND status = 1';
      db.db.get(sql, [postId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },

  // 댓글 확인
  checkComment: (commentId, postId) => {
    return new Promise((resolve, reject) => {
      const sql = 'SELECT id FROM comments WHERE id = ? AND post_id = ? AND status = 1';
      db.db.get(sql, [commentId, postId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },

  // 게시글 작성
  insertPost: (clientIP, author, title, content) => {
    return new Promise((resolve, reject) => {
      const sql = 'INSERT INTO posts (ip, author, title, content) VALUES (?, ?, ?, ?)';
      db.db.run(sql, [clientIP, author, title, content], function(err) {
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

  // 댓글 작성
  insertComment: (clientIP, postId, parentId, author, content) => {
    return new Promise((resolve, reject) => {
      const sql = 'INSERT INTO comments (ip, post_id, parent_id, author, content) VALUES (?, ?, ?, ?, ?)';
      db.db.run(sql, [clientIP, postId, parentId, author, content], function(err) {
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

  // 투표 조회
  getCurrentVote: (postId, clientIP) => {
    return new Promise((resolve, reject) => {
      const sql = 'SELECT type FROM votes WHERE post_id = ? AND ip = ? AND status = 1';
      db.db.get(sql, [postId, clientIP], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },

  // 투표 추가
  insertVote: (postId, ip, type) => {
    return new Promise((resolve, reject) => {
      const sql = 'INSERT INTO votes (post_id, ip, type) VALUES (?, ?, ?)';
      db.db.run(sql, [postId, ip, type], function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  },

  // 투표 제거
  removeVote: (postId, ip) => {
    return new Promise((resolve, reject) => {
      const sql = 'UPDATE votes SET status = 0 WHERE post_id = ? AND ip = ? AND status = 1';
      db.db.run(sql, [postId, ip], function(err) {
        if (err) reject(err);
        else resolve(this.changes > 0);
      });
    });
  },

  // 투표 변경
  updateVote: (postId, ip, newType) => {
    return new Promise((resolve, reject) => {
      const sql = 'UPDATE votes SET type = ? WHERE post_id = ? AND ip = ? AND status = 1';
      db.db.run(sql, [newType, postId, ip], function(err) {
        if (err) reject(err);
        else resolve(this.changes > 0);
      });
    });
  },

  // 게시글 투표수 업데이트
  updatePostVoteCount: (postId, type, change) => {
    return new Promise((resolve, reject) => {
      const column = type === 'like' ? 'likes' : 'dislikes';
      const sql = `UPDATE posts SET ${column} = ${column} + ? WHERE id = ?`;
      db.db.run(sql, [change, postId], function(err) {
        if (err) reject(err);
        else resolve(this.changes > 0);
      });
    });
  },

  // 투표수 조회
  getVoteCounts: (postId) => {
    return new Promise((resolve, reject) => {
      const sql = 'SELECT likes, dislikes FROM posts WHERE id = ?';
      db.db.get(sql, [postId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },

  // 게시글 상세 조회
  getPost: (postId) => {
    return new Promise((resolve, reject) => {
      const sql = 'SELECT id, ip, author, title, content, likes, dislikes, time, views FROM posts WHERE id = ? AND status = 1';
      db.db.get(sql, [postId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },

  // 댓글 목록 조회
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

app.get('/board/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'post.html'));
});

// ==================== API 라우트 ====================

// 개념글 목록 조회
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

// 글 목록 조회
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

// 특정 글 조회
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

// 글 작성
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

// 댓글 목록 조회
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

// 댓글 작성
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

// 투표 처리
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
      // 첫 투표
      await dbHelpers.insertVote(postId, clientIP, type);
      await dbHelpers.updatePostVoteCount(postId, type, 1);
      action = 'added';
      message = type === 'like' ? '좋아요를 눌렀습니다.' : '싫어요를 눌렀습니다.';
    } else if (currentVote.type === type) {
      // 투표 취소
      await dbHelpers.removeVote(postId, clientIP);
      await dbHelpers.updatePostVoteCount(postId, type, -1);
      action = 'removed';
      message = type === 'like' ? '좋아요를 취소했습니다.' : '싫어요를 취소했습니다.';
    } else {
      // 투표 변경
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
      
      // 1분마다 개념글 승격 체크
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