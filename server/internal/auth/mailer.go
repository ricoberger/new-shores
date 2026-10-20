package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/smtp"
	"net/textproto"
	"net/url"
	"regexp"
	"strings"
)

// MailError is a mail delivery failure reduced to a category that is safe
// to log: SMTP replies (e.g. "550 <player@example.org>: unknown user") and
// wrapped errors can contain the recipient address, so the original error
// is not kept.
type MailError struct {
	// Category is e.g. "smtp reply 550" or "smtp connection failed".
	Category string
}

func (e *MailError) Error() string { return "mail delivery failed: " + e.Category }

// MailFailure returns a loggable description of a Mailer error that never
// contains the recipient address or the server's reply text.
func MailFailure(err error) string {
	var me *MailError
	if errors.As(err, &me) {
		return me.Category
	}
	return "mail delivery failed"
}

// classifySMTP reduces an SMTP error to a MailError.
func classifySMTP(err error) *MailError {
	var (
		tp *textproto.Error
		ne net.Error
	)
	switch {
	case errors.As(err, &tp):
		return &MailError{Category: fmt.Sprintf("smtp reply %d", tp.Code)}
	case errors.As(err, &ne):
		return &MailError{Category: "smtp connection failed"}
	default:
		return &MailError{Category: "smtp delivery failed"}
	}
}

// Mailer sends account emails (verification, password reset).
type Mailer interface {
	Send(ctx context.Context, to, subject, body string) error
}

// LogMailer is the development mailer: it logs the subject and the SHA-256
// of the token contained in the mail (never the token, the address or the
// body).
type LogMailer struct {
	Logger *slog.Logger
}

// tokenParam finds the token in the link of an account mail.
var tokenParam = regexp.MustCompile(`token=([A-Za-z0-9_-]+)`)

// Send implements Mailer.
func (m LogMailer) Send(_ context.Context, _, subject, body string) error {
	attrs := []any{"subject", subject}
	if t := tokenParam.FindStringSubmatch(body); t != nil {
		attrs = append(attrs, "token_sha256", TokenFingerprint(t[1]))
	}
	m.Logger.Info("mail not sent (no SMTP_URL; log mailer)", attrs...)
	return nil
}

// SMTPMailer sends mail through an SMTP server (STARTTLS when offered).
type SMTPMailer struct {
	addr string
	host string
	auth smtp.Auth
	from string
}

// NewSMTPMailer parses SMTP_URL (smtp://[user:password@]host[:port]) and
// the From address.
func NewSMTPMailer(rawURL, from string) (*SMTPMailer, error) {
	u, err := url.Parse(rawURL)
	if err != nil || u.Scheme != "smtp" || u.Hostname() == "" {
		return nil, fmt.Errorf("SMTP_URL must look like smtp://user:password@host:587")
	}
	if from == "" || strings.ContainsAny(from, "\r\n") {
		return nil, fmt.Errorf("MAIL_FROM is required with SMTP_URL")
	}
	port := u.Port()
	if port == "" {
		port = "587"
	}
	m := &SMTPMailer{addr: net.JoinHostPort(u.Hostname(), port), host: u.Hostname(), from: from}
	if u.User != nil {
		pw, _ := u.User.Password()
		m.auth = smtp.PlainAuth("", u.User.Username(), pw, u.Hostname())
	}
	return m, nil
}

// Send implements Mailer.
func (m *SMTPMailer) Send(_ context.Context, to, subject, body string) error {
	if strings.ContainsAny(to+subject, "\r\n") {
		return &MailError{Category: "invalid mail header"}
	}
	msg := "From: " + m.from + "\r\nTo: " + to + "\r\nSubject: " + subject +
		"\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n" + body
	if err := smtp.SendMail(m.addr, m.auth, m.from, []string{to}, []byte(msg)); err != nil {
		return classifySMTP(err)
	}
	return nil
}
