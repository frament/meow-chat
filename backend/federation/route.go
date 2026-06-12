package federation

import "my-chat-backend/database"

type RouteHop struct {
	ServerID  int64  `json:"server_id"`
	BaseURL   string `json:"base_url"`
	NextHopID int64  `json:"next_hop_id"`
}

func FindRoute(targetServerID int64) *RouteHop {
	var directID int64
	err := database.DB.QueryRow(
		"SELECT id FROM federation_servers WHERE id = ? AND status = 'active'",
		targetServerID,
	).Scan(&directID)
	if err == nil {
		var baseURL string
		database.DB.QueryRow("SELECT base_url FROM federation_servers WHERE id = ?", targetServerID).Scan(&baseURL)
		return &RouteHop{
			ServerID:  targetServerID,
			BaseURL:   baseURL,
			NextHopID: targetServerID,
		}
	}

	type node struct {
		serverID int64
		nextHop  int64
	}
	visited := make(map[int64]bool)
	queue := []node{}

	rows, _ := database.DB.Query("SELECT id FROM federation_servers WHERE status = 'active'")
	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var id int64
			rows.Scan(&id)
			visited[id] = true
			queue = append(queue, node{serverID: id, nextHop: id})
		}
	}

	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]

		if current.serverID == targetServerID {
			var baseURL string
			database.DB.QueryRow("SELECT base_url FROM federation_network WHERE server_id = ?", targetServerID).Scan(&baseURL)
			return &RouteHop{
				ServerID:  targetServerID,
				BaseURL:   baseURL,
				NextHopID: current.nextHop,
			}
		}

		netRows, _ := database.DB.Query(
			"SELECT server_id FROM federation_network WHERE known_by_server_id = ?",
			current.serverID,
		)
		if netRows != nil {
			for netRows.Next() {
				var id int64
				netRows.Scan(&id)
				if !visited[id] {
					visited[id] = true
					queue = append(queue, node{serverID: id, nextHop: current.nextHop})
				}
			}
			netRows.Close()
		}
	}

	return nil
}
