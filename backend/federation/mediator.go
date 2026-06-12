package federation

import "my-chat-backend/database"

func IsRemoteUser(userID int64) (bool, int64) {
	var serverID int64
	err := database.DB.QueryRow(
		"SELECT server_id FROM federation_users WHERE remote_id = ?",
		userID,
	).Scan(&serverID)
	if err != nil {
		return false, 0
	}
	return true, serverID
}

func GetLocalUserID(serverID int64, remoteID int64) (int64, error) {
	var id int64
	err := database.DB.QueryRow(
		"SELECT id FROM federation_users WHERE server_id = ? AND remote_id = ?",
		serverID, remoteID,
	).Scan(&id)
	return id, err
}

func ResolveUserID(userID int64) (bool, int64) {
	remote, serverID := IsRemoteUser(userID)
	if remote {
		return false, serverID
	}
	return true, 0
}
