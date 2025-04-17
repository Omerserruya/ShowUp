export const fetchUserDetails = async (userId: string) => {
  try {
    const response = await fetch(`/users/${userId}`, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch user details');
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching user details:', error);
    throw error;
  }
}; 