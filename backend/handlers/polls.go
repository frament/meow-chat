package handlers

import (
	"database/sql"
	"strconv"
	"strings"

	"my-chat-backend/database"
	"my-chat-backend/models"

	"github.com/gofiber/fiber/v2"
)

func (h *Handler) CastVote(c *fiber.Ctx) error {
	userID := c.Locals("userId").(int64)

	pollID, err := strconv.ParseInt(c.Params("id"), 10, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid poll ID"})
	}

	var req models.PollVoteRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	var messageID, groupMessageID sql.NullInt64
	var isMultiple bool
	err = database.DB.QueryRow(
		"SELECT message_id, group_message_id, is_multiple_choice FROM polls WHERE id = ?",
		pollID,
	).Scan(&messageID, &groupMessageID, &isMultiple)
	if err == sql.ErrNoRows {
		return c.Status(404).JSON(fiber.Map{"error": "Poll not found"})
	}
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}

	if messageID.Valid {
		var fromUserID, toUserID int64
		err = database.DB.QueryRow(
			"SELECT from_user_id, to_user_id FROM messages WHERE id = ?", messageID.Int64,
		).Scan(&fromUserID, &toUserID)
		if err != nil || (userID != fromUserID && userID != toUserID) {
			return c.Status(403).JSON(fiber.Map{"error": "Access denied"})
		}
	} else if groupMessageID.Valid {
		var groupChatID int64
		err = database.DB.QueryRow(
			"SELECT group_chat_id FROM group_messages WHERE id = ?", groupMessageID.Int64,
		).Scan(&groupChatID)
		if err != nil || !isGroupMember(groupChatID, userID) {
			return c.Status(403).JSON(fiber.Map{"error": "Access denied"})
		}
	}

	var optionPollID int64
	err = database.DB.QueryRow(
		"SELECT poll_id FROM poll_options WHERE id = ?", req.OptionID,
	).Scan(&optionPollID)
	if err == sql.ErrNoRows {
		return c.Status(404).JSON(fiber.Map{"error": "Option not found"})
	}
	if optionPollID != pollID {
		return c.Status(400).JSON(fiber.Map{"error": "Option does not belong to this poll"})
	}

	if !isMultiple {
		var existingVote int64
		err = database.DB.QueryRow(
			`SELECT COUNT(*) FROM poll_votes pv
			 JOIN poll_options po ON pv.poll_option_id = po.id
			 WHERE po.poll_id = ? AND pv.user_id = ?`,
			pollID, userID,
		).Scan(&existingVote)
		if err == nil && existingVote > 0 {
			return c.Status(400).JSON(fiber.Map{"error": "You have already voted in this poll"})
		}
	}

	var existing int64
	database.DB.QueryRow(
		"SELECT COUNT(*) FROM poll_votes WHERE poll_option_id = ? AND user_id = ?",
		req.OptionID, userID,
	).Scan(&existing)
	if existing > 0 {
		return c.Status(400).JSON(fiber.Map{"error": "You have already voted for this option"})
	}

	_, err = database.DB.Exec(
		"INSERT INTO poll_votes (poll_option_id, user_id) VALUES (?, ?)",
		req.OptionID, userID,
	)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to cast vote"})
	}

	options := loadPollOptions(pollID, userID)
	h.broadcastPollUpdate(pollID, messageID, groupMessageID, options)

	return c.JSON(fiber.Map{"message": "Vote cast", "options": options})
}

func loadPollOptions(pollID, userID int64) []fiber.Map {
	rows, err := database.DB.Query(`
		SELECT po.id, po.text,
			COALESCE((SELECT COUNT(*) FROM poll_votes WHERE poll_option_id = po.id), 0) as vote_count,
			CASE WHEN EXISTS (SELECT 1 FROM poll_votes WHERE poll_option_id = po.id AND user_id = ?) THEN 1 ELSE 0 END as voted
		FROM poll_options po
		WHERE po.poll_id = ?
		ORDER BY po.id
	`, userID, pollID)
	if err != nil {
		return nil
	}
	defer rows.Close()

	var options []fiber.Map
	for rows.Next() {
		var id int64
		var text string
		var voteCount int
		var voted int
		if rows.Scan(&id, &text, &voteCount, &voted) == nil {
			options = append(options, fiber.Map{
				"id":         id,
				"text":       text,
				"vote_count": voteCount,
				"voted":      voted == 1,
			})
		}
	}
	return options
}

func (h *Handler) broadcastPollUpdate(pollID int64, messageID, groupMessageID sql.NullInt64, options []fiber.Map) {
	var totalVotes int
	for _, opt := range options {
		if v, ok := opt["vote_count"].(int); ok {
			totalVotes += v
		}
	}

	payload := fiber.Map{
		"type":         "poll_update",
		"poll_id":      pollID,
		"options":      options,
		"total_votes":  totalVotes,
	}

	if messageID.Valid {
		payload["message_id"] = messageID.Int64
		var fromUserID, toUserID int64
		database.DB.QueryRow(
			"SELECT from_user_id, to_user_id FROM messages WHERE id = ?", messageID.Int64,
		).Scan(&fromUserID, &toUserID)
		h.SendToUser(fromUserID, payload)
		h.SendToUser(toUserID, payload)
	} else if groupMessageID.Valid {
		payload["group_message_id"] = groupMessageID.Int64
		var groupChatID int64
		database.DB.QueryRow(
			"SELECT group_chat_id FROM group_messages WHERE id = ?", groupMessageID.Int64,
		).Scan(&groupChatID)
		rows, err := database.DB.Query(
			"SELECT user_id FROM group_chat_members WHERE group_chat_id = ?", groupChatID,
		)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var uid int64
				rows.Scan(&uid)
				h.SendToUser(uid, payload)
			}
		}
	}
}

func loadPollsForMessages(messages []models.Message, userID int64, isGroup bool) {
	if len(messages) == 0 {
		return
	}

	msgIDs := make([]interface{}, 0, len(messages))
	idPos := make([]int64, 0, len(messages))
	for _, m := range messages {
		msgIDs = append(msgIDs, m.ID)
		idPos = append(idPos, m.ID)
	}

	placeholders := make([]string, len(msgIDs))
	for i := range msgIDs {
		placeholders[i] = "?"
	}

	var col string
	if isGroup {
		col = "group_message_id"
	} else {
		col = "message_id"
	}

	query := `SELECT p.id, p.` + col + `, p.question, p.is_multiple_choice, po.id, po.text,
		COALESCE((SELECT COUNT(*) FROM poll_votes WHERE poll_option_id = po.id), 0),
		CASE WHEN EXISTS (SELECT 1 FROM poll_votes WHERE poll_option_id = po.id AND user_id = ?) THEN 1 ELSE 0 END
	FROM polls p
	LEFT JOIN poll_options po ON po.poll_id = p.id
	WHERE p.` + col + ` IN (` + strings.Join(placeholders, ",") + `)
	ORDER BY po.id`

	args := make([]interface{}, 0, len(msgIDs)+1)
	args = append(args, userID)
	args = append(args, msgIDs...)

	rows, err := database.DB.Query(query, args...)
	if err != nil {
		return
	}
	defer rows.Close()

	pollMap := make(map[int64]*models.Poll)
	for rows.Next() {
		var pollID, msgID int64
		var question string
		var isMultiple bool
		var optID sql.NullInt64
		var optText sql.NullString
		var voteCount int
		var voted int

		if err := rows.Scan(&pollID, &msgID, &question, &isMultiple, &optID, &optText, &voteCount, &voted); err != nil {
			continue
		}

		poll, ok := pollMap[pollID]
		if !ok {
			poll = &models.Poll{
				ID:               pollID,
				Question:         question,
				IsMultipleChoice: isMultiple,
				Options:          make([]models.PollOption, 0),
			}
			if isGroup {
				poll.GroupMessageID = &msgID
			} else {
				poll.MessageID = &msgID
			}
			pollMap[pollID] = poll
		}

		if optID.Valid {
			poll.Options = append(poll.Options, models.PollOption{
				ID:        optID.Int64,
				PollID:    pollID,
				Text:      optText.String,
				VoteCount: voteCount,
				Voted:     voted == 1,
			})
		}
	}

	for i := range messages {
		for _, poll := range pollMap {
			var matchID int64
			if isGroup && poll.GroupMessageID != nil {
				matchID = *poll.GroupMessageID
			} else if !isGroup && poll.MessageID != nil {
				matchID = *poll.MessageID
			}
			if matchID == messages[i].ID {
				messages[i].Poll = poll
				break
			}
		}
	}
}
