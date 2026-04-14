import { useState, useEffect, useRef, useCallback } from 'react';

export function useMessages() {
  const [showMessageBoard, setShowMessageBoard] = useState(false);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState({ username: '', content: '' });
  const [showRandomMessage, setShowRandomMessage] = useState(false);
  const [randomMessage, setRandomMessage] = useState(null);
  const [likedMessages, setLikedMessages] = useState(new Set());
  const randomMessageInterval = useRef(null);

  const fetchMessages = useCallback(async () => {
    try {
      const response = await fetch('/api/messages');
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const messagesData = await response.json();
      setMessages(messagesData);
      if (messagesData.length > 0) {
        startRandomMessageDisplay(messagesData);
      }
    } catch (error) {
      console.error('获取留言失败:', error);
    }
  }, []);

  useEffect(() => {
    fetchMessages();
    return () => {
      if (randomMessageInterval.current) {
        clearInterval(randomMessageInterval.current);
      }
    };
  }, [fetchMessages]);

  const showRandomMessageFunc = useCallback((messagesData) => {
    if (messagesData.length > 0) {
      const randomIndex = Math.floor(Math.random() * messagesData.length);
      setRandomMessage(messagesData[randomIndex]);
    }
  }, []);

  const startRandomMessageDisplay = useCallback((messagesData) => {
    if (messagesData.length > 0) {
      showRandomMessageFunc(messagesData);
      randomMessageInterval.current = setInterval(() => {
        showRandomMessageFunc(messagesData);
      }, 10000);
      setShowRandomMessage(true);
    }
  }, [showRandomMessageFunc]);

  const handleSubmitMessage = useCallback(async (e) => {
    e.preventDefault();
    if (!newMessage.username.trim() || !newMessage.content.trim()) {
      alert('请填写用户名和留言内容');
      return;
    }
    try {
      const response = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newMessage),
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }
      const message = await response.json();
      setMessages(prev => [message, ...prev]);
      setNewMessage({ username: '', content: '' });
      if (messages.length === 0) {
        startRandomMessageDisplay([message, ...messages]);
      }
    } catch (error) {
      console.error('提交留言失败:', error);
      alert('提交留言失败，请稍后重试: ' + error.message);
    }
  }, [newMessage, messages, startRandomMessageDisplay]);

  const likeMessage = useCallback(async (messageId) => {
    try {
      const isLiked = likedMessages.has(messageId);
      const action = isLiked ? 'unlike' : 'like';
      const response = await fetch('/api/messages', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: messageId, action }),
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }
      const updatedMessage = await response.json();
      setMessages(prev => prev.map(msg => msg.id === messageId ? updatedMessage : msg));
      setLikedMessages(prev => {
        const newLiked = new Set(prev);
        if (newLiked.has(messageId)) newLiked.delete(messageId);
        else newLiked.add(messageId);
        return newLiked;
      });
    } catch (error) {
      console.error('点赞失败:', error);
      alert('点赞失败: ' + error.message);
    }
  }, [likedMessages]);

  return {
    showMessageBoard, setShowMessageBoard,
    messages,
    newMessage, setNewMessage,
    showRandomMessage, setShowRandomMessage,
    randomMessage,
    likedMessages,
    handleSubmitMessage,
    likeMessage,
  };
}
