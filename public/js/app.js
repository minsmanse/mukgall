const API_BASE_URL = 'http://localhost:3000/api/public';

document.addEventListener('DOMContentLoaded', () => {
    const path = window.location.pathname;

    if (path === '/board') {
        initBoardPage();
    } else if (path === '/board/gaenyeom') {
        initRecommendedPage();
    } else if (path === '/board/write') {
        initWritePage();
    } else if (/^\/board\/\d+$/.test(path)) {
        initPostPage();
    }
});

function createPostRow(post) {
    const postRow = document.createElement('a');
    postRow.href = `/board/${post.id}`;
    postRow.className = 'post-row';

    let titleHtml = escapeHTML(post.title);

    if (post.promoted_at) {
        postRow.classList.add('recommended-post');
        titleHtml = `<span class="recommended-title-prefix">개념</span>` + titleHtml;

        const promotedDate = new Date(post.promoted_at.replace(' ', 'T') + 'Z');
        const hoursDiff = (new Date() - promotedDate) / 3600000;
        
        if (hoursDiff < 24) {
            postRow.classList.add('new-recommended-post');
        }
    }

    postRow.innerHTML = `
        <div class="col-id">${post.id}</div>
        <div class="col-title">${titleHtml}</div>
        <div class="col-author">${escapeHTML(post.author)} (${post.author_ip})</div>
        <div class="col-time">${formatDate(post.time)}</div>
        <div class="col-views">${post.views || 0}</div>
        <div class="col-likes">${post.likes || 0}</div>
    `;
    return postRow;
}

function initBoardPage() {
    let currentPage = 1;
    const postListBody = document.getElementById('post-list-body');
    const loadMoreBtn = document.getElementById('load-more-btn');

    async function fetchPosts(page) {
        try {
            const response = await fetch(`${API_BASE_URL}/posts?page=${page}&limit=15`);
            const result = await response.json();
            if (result.success && result.data.length > 0) {
                result.data.forEach(post => postListBody.appendChild(createPostRow(post)));
                loadMoreBtn.style.display = result.data.length < 15 ? 'block' : 'none';
                currentPage++;
            } else {
                loadMoreBtn.style.display = 'none';
            }
        } catch (error) {
            console.error('Error fetching posts:', error);
            loadMoreBtn.style.display = 'none';
        }
    }
    loadMoreBtn.addEventListener('click', () => fetchPosts(currentPage));
    fetchPosts(currentPage);
}

function initRecommendedPage() {
    let currentPage = 1;
    const postListBody = document.getElementById('post-list-body');
    const loadMoreBtn = document.getElementById('load-more-btn');

    async function fetchPosts(page) {
        try {
            const response = await fetch(`${API_BASE_URL}/recommended-posts?page=${page}&limit=15`);
            const result = await response.json();
            if (result.success && result.data.length > 0) {
                result.data.forEach(post => postListBody.appendChild(createPostRow(post)));
                loadMoreBtn.style.display = result.data.length < 15 ? 'block' : 'none';
                currentPage++;
            } else {
                loadMoreBtn.style.display = 'none';
                if (page === 1) postListBody.innerHTML = '<div class="post-row" style="justify-content:center; padding: 20px;">개념글이 없습니다.</div>';
            }
        } catch (error) {
            console.error('Error fetching recommended posts:', error);
            loadMoreBtn.style.display = 'none';
        }
    }
    loadMoreBtn.addEventListener('click', () => fetchPosts(currentPage));
    fetchPosts(currentPage);
}

async function initPostPage() {
    const postContainer = document.getElementById('post-container');
    const commentsContainer = document.getElementById('comments-container');
    const pathParts = window.location.pathname.split('/');
    const postId = pathParts[pathParts.length - 1];

    if (!postId || !/^\d+$/.test(postId)) {
        postContainer.innerHTML = '<p>잘못된 접근입니다.</p>';
        return;
    }

    async function renderPost() {
        try {
            const response = await fetch(`${API_BASE_URL}/post/${postId}`);
            const result = await response.json();

            if (result.success) {
                const post = result.data;
                document.title = post.title;
                postContainer.innerHTML = `
                    <div class="post-view-header">
                        <h2>${escapeHTML(post.title)}</h2>
                    </div>
                    <div class="post-meta">
                        <span class="author-info">
                            <strong>${escapeHTML(post.author)}</strong>
                            <span class="author-ip">(${post.author_ip})</span>
                        </span>
                        <span class="meta-details">
                            <span>${new Date(post.time).toLocaleString()}</span>
                            <span style="margin-left: 10px;">조회 ${post.views || 0}</span>
                        </span>
                    </div>
                    <div class="post-content">${post.content}</div>
                    <div class="post-actions">
                        <button id="like-btn" class="btn vote-btn ${post.user_vote === 'like' ? 'liked' : ''}">개추 <span id="likes-count">${post.likes}</span></button>
                        <button id="dislike-btn" class="btn vote-btn ${post.user_vote === 'dislike' ? 'disliked' : ''}">비추 <span id="dislikes-count">${post.dislikes}</span></button>
                    </div>
                `;
                addVoteEventListeners(postId);
            } else {
                postContainer.innerHTML = `<p>${result.message}</p>`;
            }
        } catch (error) {
            console.error('Error fetching post:', error);
            postContainer.innerHTML = `<p>글을 불러오는 중 오류가 발생했습니다.</p>`;
        }
    }

    async function renderComments() {
        try {
            const response = await fetch(`${API_BASE_URL}/comments/${postId}`);
            const result = await response.json();
            
            if (result.success) {
                const { comments, total_count } = result.data;
                let commentsHtml = `<div class="comment-count">전체댓글 ${total_count}개</div>`;
                commentsHtml += buildCommentsTree(comments);
                commentsHtml += generateCommentForm();
                commentsContainer.innerHTML = commentsHtml;
                addCommentFormEventListeners();
            }
        } catch (error) {
            console.error('Error fetching comments:', error);
        }
    }
    
    await renderPost();
    await renderComments();
}

function addVoteEventListeners(postId) {
    const likeBtn = document.getElementById('like-btn');
    const dislikeBtn = document.getElementById('dislike-btn');

    async function handleVote(type) {
        try {
            const response = await fetch(`${API_BASE_URL}/vote/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ post_id: postId, type: type })
            });
            const result = await response.json();
            if (result.success) {
                document.getElementById('likes-count').textContent = result.data.likes;
                document.getElementById('dislikes-count').textContent = result.data.dislikes;
                likeBtn.classList.toggle('liked', result.data.current_vote === 'like');
                dislikeBtn.classList.toggle('disliked', result.data.current_vote === 'dislike');
            } else {
                alert(result.message);
            }
        } catch (error) {
            console.error('Vote error:', error);
        }
    }

    likeBtn.addEventListener('click', () => handleVote('like'));
    dislikeBtn.addEventListener('click', () => handleVote('dislike'));
}

function buildCommentsTree(comments) {
    let html = '';
    for (const comment of comments) {
        html += `
            <div class="comment" id="comment-${comment.id}">
                <div class="comment-meta">
                    <span class="author-info">
                        <strong>${escapeHTML(comment.author)}</strong>
                        <span class="author-ip">(${comment.author_ip})</span>
                    </span>
                    <span class="comment-details">
                        ${formatDate(comment.time, true)}
                        <span class="comment-id">(${comment.id})</span>
                    </span>
                </div>
                <div class="comment-content">${escapeHTML(comment.content)}</div>
                <div class="comment-actions">
                    <a href="#" class="reply-btn" data-comment-id="${comment.id}">답글쓰기</a>
                </div>
                <div class="reply-form-container"></div>
            </div>
        `;
        if (comment.replies && comment.replies.length > 0) {
            html += `<div class="comment-reply">${buildCommentsTree(comment.replies)}</div>`;
        }
    }
    return html;
}

function generateCommentForm(parentId = null) {
    const formId = parentId ? `reply-form-${parentId}` : 'comment-form-root';
    return `
        <form class="comment-form ${parentId ? 'reply-form' : ''}" id="${formId}" data-parent-id="${parentId || ''}">
            <div class="comment-form-meta">
                <input type="text" name="author" placeholder="닉네임" required>
            </div>
            <textarea name="content" placeholder="댓글을 입력하세요" required></textarea>
            <div class="comment-form-actions">
                <button type="submit" class="btn btn-primary">등록</button>
            </div>
        </form>
    `;
}

function addCommentFormEventListeners() {
    const pathParts = window.location.pathname.split('/');
    const postId = pathParts[pathParts.length - 1];

    document.querySelectorAll('.comment-form').forEach(form => {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const parentId = form.dataset.parentId || null;
            const author = form.querySelector('input[name="author"]').value;
            const content = form.querySelector('textarea[name="content"]').value;

            try {
                const response = await fetch(`${API_BASE_URL}/comment/`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ post_id: postId, parent_id: parentId, author, content })
                });
                const result = await response.json();
                if (result.success) {
                    initPostPage();
                } else {
                    alert(result.message);
                }
            } catch (error) {
                console.error('Comment submission error:', error);
            }
        });
    });

    document.querySelectorAll('.reply-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const commentId = btn.dataset.commentId;
            const container = document.querySelector(`#comment-${commentId} .reply-form-container`);
            
            if (container.innerHTML) {
                container.innerHTML = '';
            } else {
                container.innerHTML = generateCommentForm(commentId);
                addCommentFormEventListeners();
            }
        });
    });
}

function initWritePage() {
    const quill = new Quill('#editor', {
        theme: 'snow',
        modules: {
            toolbar: {
                container: [
                    [{ 'header': [1, 2, 3, false] }],
                    ['bold', 'italic', 'underline', 'strike'],
                    [{ 'color': [] }, { 'background': [] }],
                    [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                    [{ 'align': [] }],
                    ['link', 'image'],
                    ['clean']
                ]
            }
        }
    });

    const form = document.getElementById('write-form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const author = document.getElementById('author').value;
        const title = document.getElementById('title').value;
        const content = quill.root.innerHTML;

        if (!author.trim() || !title.trim() || quill.getLength() <= 1) {
            alert('닉네임, 제목, 내용을 모두 입력해주세요.');
            return;
        }

        try {
            const response = await fetch(`${API_BASE_URL}/post/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ author, title, content })
            });
            const result = await response.json();

            if (result.success) {
                window.location.href = `/board/${result.data.id}`;
            } else {
                alert('글 등록에 실패했습니다: ' + result.message);
            }
        } catch (error) {
            console.error('Error submitting post:', error);
        }
    });
}

function escapeHTML(str) {
    if (!str) return '';
    const p = document.createElement('p');
    p.textContent = str;
    return p.innerHTML;
}

function formatDate(dateString, full = false) {
    const date = new Date(dateString.replace(' ', 'T') + 'Z');

    if (full) {
        return date.toLocaleString('ko-KR', {
            year: '2-digit',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }).replace(/\. /g, '.').replace(/,/g, '');
    }

    return date.toLocaleString('ko-KR', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).replace(/\. /g, '.').replace(/,/g, '');
}