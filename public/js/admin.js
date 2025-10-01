const API_BASE_URL = 'http://localhost:3000/api';

let currentPostPage = 1;
let currentCommentPage = 1;
let currentStatusFilter = 'active';
let currentSearchQuery = '';
const itemsPerPage = 20;

// 인증 확인
async function checkAuth() {
    try {
        const response = await fetch(`${API_BASE_URL}/admin/auth/check`, {
            credentials: 'include'
        });
        const result = await response.json();
        
        if (!result.success || !result.isAdmin) {
            window.location.href = `${API_BASE_URL}/admin/auth/google`;
            return false;
        }
        
        document.getElementById('admin-info').innerHTML = `
            <span style="color: var(--claude-text-muted);">${result.name}</span>
        `;
        return true;
    } catch (error) {
        console.error('Auth check error:', error);
        window.location.href = `${API_BASE_URL}/admin/auth/google`;
        return false;
    }
}

// 탭 전환
function setupTabs() {
    document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
            
            tab.classList.add('active');
            const tabName = tab.dataset.tab;
            document.getElementById(`${tabName}-tab`).classList.add('active');
            
            if (tabName === 'posts') loadPosts();
            else if (tabName === 'comments') loadComments();
            else if (tabName === 'stats') loadStats();
        });
    });
}

// 필터 설정
function setupFilters() {
    document.getElementById('status-filter').addEventListener('change', (e) => {
        currentStatusFilter = e.target.value;
        currentPostPage = 1;
        currentCommentPage = 1;
        const activeTab = document.querySelector('.admin-tab.active').dataset.tab;
        if (activeTab === 'posts') loadPosts();
        else if (activeTab === 'comments') loadComments();
    });

    let searchTimeout;
    document.getElementById('search-input').addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            currentSearchQuery = e.target.value;
            currentPostPage = 1;
            currentCommentPage = 1;
            const activeTab = document.querySelector('.admin-tab.active').dataset.tab;
            if (activeTab === 'posts') loadPosts();
            else if (activeTab === 'comments') loadComments();
        }, 300);
    });
}

// 게시글 목록 로드
async function loadPosts() {
    try {
        const response = await fetch(
            `${API_BASE_URL}/admin/posts?page=${currentPostPage}&limit=${itemsPerPage}&status=${currentStatusFilter}&search=${encodeURIComponent(currentSearchQuery)}`,
            { credentials: 'include' }
        );
        const result = await response.json();

        if (result.success) {
            renderPosts(result.data);
            updatePagination('posts', result.pagination);
        }
    } catch (error) {
        console.error('Error loading posts:', error);
    }
}

// 게시글 렌더링
function renderPosts(posts) {
    const tbody = document.getElementById('posts-tbody');
    
    if (posts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 40px;">게시글이 없습니다.</td></tr>';
        return;
    }

    tbody.innerHTML = posts.map(post => {
        const statusBadge = post.status === 0 
            ? '<span class="status-badge deleted">삭제됨</span>' 
            : post.is_notice === 1 
                ? '<span class="status-badge notice">공지</span>'
                : '<span class="status-badge active">활성</span>';
        
        const actions = post.status === 0 
            ? `
                <button class="btn-small btn-success" onclick="restorePost(${post.id})">복원</button>
                <button class="btn-small btn-danger" onclick="hardDeletePost(${post.id})">영구삭제</button>
            `
            : `
                <button class="btn-small" onclick="toggleNotice(${post.id}, ${post.is_notice})">${post.is_notice ? '공지해제' : '공지설정'}</button>
                <button class="btn-small btn-warning" onclick="softDeletePost(${post.id})">삭제</button>
            `;

        return `
            <tr class="${post.status === 0 ? 'deleted-row' : ''}">
                <td>${post.id}</td>
                <td class="text-left"><a href="/board/${post.id}" target="_blank">${escapeHTML(post.title)}</a></td>
                <td>${escapeHTML(post.author)}</td>
                <td>${post.ip}</td>
                <td>${formatDateTime(post.time)}</td>
                <td>${post.views}</td>
                <td>${post.likes}</td>
                <td>${statusBadge}</td>
                <td class="action-cell">${actions}</td>
            </tr>
        `;
    }).join('');
}

// 댓글 목록 로드
async function loadComments() {
    try {
        const response = await fetch(
            `${API_BASE_URL}/admin/comments?page=${currentCommentPage}&limit=${itemsPerPage}&status=${currentStatusFilter}&search=${encodeURIComponent(currentSearchQuery)}`,
            { credentials: 'include' }
        );
        const result = await response.json();

        if (result.success) {
            renderComments(result.data);
            updatePagination('comments', result.pagination);
        }
    } catch (error) {
        console.error('Error loading comments:', error);
    }
}

// 댓글 렌더링
function renderComments(comments) {
    const tbody = document.getElementById('comments-tbody');
    
    if (comments.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 40px;">댓글이 없습니다.</td></tr>';
        return;
    }

    tbody.innerHTML = comments.map(comment => {
        const statusBadge = comment.status === 0 
            ? '<span class="status-badge deleted">삭제됨</span>' 
            : '<span class="status-badge active">활성</span>';
        
        const actions = comment.status === 0 
            ? `
                <button class="btn-small btn-success" onclick="restoreComment(${comment.id})">복원</button>
                <button class="btn-small btn-danger" onclick="hardDeleteComment(${comment.id})">영구삭제</button>
            `
            : `
                <button class="btn-small btn-warning" onclick="softDeleteComment(${comment.id})">삭제</button>
            `;

        return `
            <tr class="${comment.status === 0 ? 'deleted-row' : ''}">
                <td>${comment.id}</td>
                <td><a href="/board/${comment.post_id}" target="_blank">#${comment.post_id}</a></td>
                <td>${escapeHTML(comment.author)}</td>
                <td>${comment.ip}</td>
                <td class="text-left">${escapeHTML(comment.content.substring(0, 50))}${comment.content.length > 50 ? '...' : ''}</td>
                <td>${formatDateTime(comment.time)}</td>
                <td>${statusBadge}</td>
                <td class="action-cell">${actions}</td>
            </tr>
        `;
    }).join('');
}

// 페이지네이션 업데이트
function updatePagination(type, pagination) {
    const pageInfo = document.getElementById(`${type}-page-info`);
    const prevBtn = document.getElementById(`${type}-prev`);
    const nextBtn = document.getElementById(`${type}-next`);

    pageInfo.textContent = `${pagination.page} / ${pagination.totalPages}`;
    prevBtn.disabled = pagination.page <= 1;
    nextBtn.disabled = pagination.page >= pagination.totalPages;
}

// 페이지네이션 설정
function setupPagination() {
    document.getElementById('posts-prev').addEventListener('click', () => {
        if (currentPostPage > 1) {
            currentPostPage--;
            loadPosts();
        }
    });

    document.getElementById('posts-next').addEventListener('click', () => {
        currentPostPage++;
        loadPosts();
    });

    document.getElementById('comments-prev').addEventListener('click', () => {
        if (currentCommentPage > 1) {
            currentCommentPage--;
            loadComments();
        }
    });

    document.getElementById('comments-next').addEventListener('click', () => {
        currentCommentPage++;
        loadComments();
    });
}

// 공지 설정/해제
async function toggleNotice(postId, currentStatus) {
    try {
        const response = await fetch(`${API_BASE_URL}/admin/notice/${postId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ is_notice: currentStatus ? 0 : 1 })
        });
        const result = await response.json();

        if (result.success) {
            alert(result.message);
            loadPosts();
        } else {
            alert('오류: ' + result.message);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('오류가 발생했습니다.');
    }
}

// 소프트 삭제 (게시글)
async function softDeletePost(postId) {
    if (!confirm('이 게시글을 삭제하시겠습니까? (복원 가능)')) return;

    try {
        const response = await fetch(`${API_BASE_URL}/admin/post/${postId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        const result = await response.json();

        if (result.success) {
            alert(result.message);
            loadPosts();
        } else {
            alert('오류: ' + result.message);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('오류가 발생했습니다.');
    }
}

// 하드 삭제 (게시글)
async function hardDeletePost(postId) {
    if (!confirm('⚠️ 영구 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다!')) return;

    try {
        const response = await fetch(`${API_BASE_URL}/admin/post/${postId}?hard=true`, {
            method: 'DELETE',
            credentials: 'include'
        });
        const result = await response.json();

        if (result.success) {
            alert(result.message);
            loadPosts();
        } else {
            alert('오류: ' + result.message);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('오류가 발생했습니다.');
    }
}

// 복원 (게시글)
async function restorePost(postId) {
    if (!confirm('이 게시글을 복원하시겠습니까?')) return;

    try {
        const response = await fetch(`${API_BASE_URL}/admin/post/${postId}/restore`, {
            method: 'POST',
            credentials: 'include'
        });
        const result = await response.json();

        if (result.success) {
            alert(result.message);
            loadPosts();
        } else {
            alert('오류: ' + result.message);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('오류가 발생했습니다.');
    }
}

// 소프트 삭제 (댓글)
async function softDeleteComment(commentId) {
    if (!confirm('이 댓글을 삭제하시겠습니까? (복원 가능)')) return;

    try {
        const response = await fetch(`${API_BASE_URL}/admin/comment/${commentId}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        const result = await response.json();

        if (result.success) {
            alert(result.message);
            loadComments();
        } else {
            alert('오류: ' + result.message);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('오류가 발생했습니다.');
    }
}

// 하드 삭제 (댓글)
async function hardDeleteComment(commentId) {
    if (!confirm('⚠️ 영구 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다!')) return;

    try {
        const response = await fetch(`${API_BASE_URL}/admin/comment/${commentId}?hard=true`, {
            method: 'DELETE',
            credentials: 'include'
        });
        const result = await response.json();

        if (result.success) {
            alert(result.message);
            loadComments();
        } else {
            alert('오류: ' + result.message);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('오류가 발생했습니다.');
    }
}

// 복원 (댓글)
async function restoreComment(commentId) {
    if (!confirm('이 댓글을 복원하시겠습니까?')) return;

    try {
        const response = await fetch(`${API_BASE_URL}/admin/comment/${commentId}/restore`, {
            method: 'POST',
            credentials: 'include'
        });
        const result = await response.json();

        if (result.success) {
            alert(result.message);
            loadComments();
        } else {
            alert('오류: ' + result.message);
        }
    } catch (error) {
        console.error('Error:', error);
        alert('오류가 발생했습니다.');
    }
}

// 통계 로드
async function loadStats() {
    try {
        const response = await fetch(`${API_BASE_URL}/admin/stats`, {
            credentials: 'include'
        });
        const result = await response.json();

        if (result.success) {
            const stats = result.data;
            document.getElementById('total-posts').textContent = stats.totalPosts;
            document.getElementById('active-posts').textContent = stats.activePosts;
            document.getElementById('deleted-posts').textContent = stats.deletedPosts;
            document.getElementById('total-notices').textContent = stats.notices;
            document.getElementById('total-recommended').textContent = stats.recommended;
            document.getElementById('total-comments').textContent = stats.totalComments;
        }
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

// 로그아웃
function setupLogout() {
    document.getElementById('logout-btn').addEventListener('click', async () => {
        try {
            await fetch(`${API_BASE_URL}/admin/auth/logout`, {
                method: 'POST',
                credentials: 'include'
            });
            window.location.href = '/board';
        } catch (error) {
            console.error('Logout error:', error);
        }
    });
}

// 유틸리티 함수
function escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatDateTime(dateString) {
    const date = new Date(dateString.replace(' ', 'T') + 'Z');
    return date.toLocaleString('ko-KR', {
        year: '2-digit',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).replace(/\. /g, '.').replace(/,/g, '');
}

// 초기화
document.addEventListener('DOMContentLoaded', () => {
    checkAuth().then(isAuth => {
        if (isAuth) {
            setupTabs();
            setupFilters();
            setupPagination();
            setupLogout();
            loadPosts();
        }
    });
});