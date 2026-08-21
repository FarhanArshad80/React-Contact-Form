n=(input('Enter your name:').replace(' ','')).lower()
r=int(input('Enter roll no:'))
p=len(n)
v=0
count=0
vowels=['a','e','i','o','u']
for i in n:
    if i in vowels:
        v+=1
total=0
product=1
if p%2==0 and r%2==0:
    j=v
    while count<20:
        if j%2==0:
            print(j)
            total+=j
            product*=j
            count+=1
        j+=1
elif p%2==1 and r%2==1:
    j=v
    while count<20:
        if j%2==1:
            print(j)
            total+=j
            product*=j
            count+=1
        j+=1

else:
    i=v
    while count<20:
        # Check if i is prime
        is_prime = True
        if i <= 1:
            is_prime = False
        else:
            for k in range(2, int(i ** 0.5) + 1):
                if i % k == 0:
                    is_prime = False
                    break
        
        if is_prime:
            print(i)
            total+=i
            product*=i
            count+=1
        i+=1
print(f'total:{total} \nProduct:{product}')