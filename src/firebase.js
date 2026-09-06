import firebase from "firebase/compat/app";
import "firebase/compat/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDPCP7IQM4dJ6om7MOXBszRmeHwfzC1-1g",
  authDomain: "furnizapchast-4a429.firebaseapp.com",
  projectId: "furnizapchast-4a429",
  storageBucket: "furnizapchast-4a429.firebasestorage.app",
  messagingSenderId: "749013518263",
  appId: "1:749013518263:web:94c749465c0415fd2c4a32",
};

const app = firebase.apps.length
  ? firebase.app()
  : firebase.initializeApp(firebaseConfig);

export const db = app.firestore();
export { firebase };
