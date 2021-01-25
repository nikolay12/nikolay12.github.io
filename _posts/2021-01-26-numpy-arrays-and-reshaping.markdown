---
layout: notebook
title:  "Numpy Arrays and Reshapes"
date:   2021-01-26 00:07:00
categories: Blog
---

# Numpy Array Ranks and Reshaping

A lot of numpy functions generate rank 1 arrays. A simple example:


```
import numpy as np
x = np.linspace(0,1)
x.shape
```




    (50,)



The shape attribute of a numpy array is a tuple listing the size of each of its dimensions (axes). In this case there is just one dimension. The number of dimensions/axes is simply the length of its shape attribute:


```
len(x.shape)
```




    1



An array of rank 1 is called a *vector*. Which is not the same as *matrix* with one column.

The problem is that a lot of scikit functions require matrices (e.g. submitting the training data has to be in the form of a matrix even if it contains just one feature). So if you try submitting a vector you get the common "*ValueError: Expected 2D Arrays, got 1D array instead*".

This is where reshaping becomes necessary.


```
x2 = x.reshape(-1,1)
x2.shape
```




    (50, 1)



Now the new array x2 is of rank 2 (has two dimensions) - the first is of size 50, and the second is of size 1.

What is the meaning of -1 here?

It simply acts as a placeholder - the size of that axis is determined depending on the size of the other axes. In this particular case we asked that the second axis is of size 1 so in order to be able to accommodate all the elements the first axis of the new array has to be of size 50.

This is how usually the reshaping is performed. At least, this is how I have been doing it. But [a lecture of Jeremy Howard](https://youtu.be/BFIYUvBRTpE?t=5400) made me aware of other ways to achieve the same result.


```
x2 = x[:, None]
x2.shape
```




    (50, 1)



In the above example we used slicing to achieve the same result. The colon (:), essentially, means 'get everything from that axis'. 'None' simply adds an axis of length 1. And it can be added anywhere:


```
x2 = x[None, :]
x2.shape
```




    (1, 50)



In this particular case we added axis of length 1 as a first axis.

We can, actually, achieve the same by omitting the colon:


```
x2 = x[None]
x2.shape
```




    (1, 50)



But so far our example was related to adding one dimension to a 1D array. What if the array has originally more dimensions?

We can explicitly specify them. Or, if the new dimension is supposed to be appended than we can do it this way:


```
x2 = x[...,None]
x2.shape
```




    (50, 1)



There is yet another way to reshape (not mentioned by Jeremy):


```
x2 = x[:] #the slicing is just another way to create a copy of x
x2.shape = (50,1)
x2.shape
```




    (50, 1)



## Summary

The vectors and matrixes are just n-dimensional arrays. In the case of vectors n = 1.

Even though the content of a vector may be the same as a matrix with 1 column they are still considered arrays of different dimensions. Thus it is often necessary to convert a vector to a corresponding matrix. This can be performed in 3 different ways:


1.   By using reshape(-1,1). This generates a new 2D array with the last one being of size 1.
2.   By slicing and using 'None' to add a dimension of size 1.
3.   By changing the shape attribute of the vector.
