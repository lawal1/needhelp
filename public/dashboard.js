// public/dashboard.js
// Shared helper functions for dashboard pages
async function getAuthToken() {
    const user = firebase.auth().currentUser;
    if (!user) throw new Error('No user');
    return await user.getIdToken();
}