
import React, { useEffect, useState } from 'react';

interface MessageBoxProps {
    message: string;
    onClose: () => void;
}

export const MessageBox: React.FC<MessageBoxProps> = ({ message, onClose }) => {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        setVisible(true);
        const timer = setTimeout(() => {
            setVisible(false);
            // Allow time for fade-out animation before calling onClose
            setTimeout(onClose, 300);
        }, 4000);

        return () => clearTimeout(timer);
    }, [message, onClose]);

    return (
        <div 
            className={`fixed bottom-5 right-5 bg-red-600 text-white py-3 px-5 rounded-lg shadow-xl transition-all duration-300 ease-in-out ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`}
        >
            <span>{message}</span>
        </div>
    );
};
